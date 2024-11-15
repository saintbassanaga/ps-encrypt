import { Injectable, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, ReplaySubject, distinctUntilChanged, iif, map, of, switchMap, take, tap, throwError } from 'rxjs';
import { EncryptionMap, EncryptionMapJsonSchema, EncryptionTable, EncryptionVerificationResult } from './encryption.types';
import { ENCRYPTION_TABLES_SOURCE } from './encryption.constants';

@Injectable()
export class EncryptionService {

  private _encryptionTablesLoaded = false;

  private readonly _encryptionTables: ReplaySubject<EncryptionTable[]> = new ReplaySubject<EncryptionTable[]>(1);
  private readonly _encryptionMap: ReplaySubject<EncryptionMap> = new ReplaySubject<EncryptionMap>(1);
  private readonly _selectedEncryptionTable: BehaviorSubject<EncryptionTable | null> = new BehaviorSubject<EncryptionTable | null>(null);

  private _encryptionMapCache = new Map<string, EncryptionMap>();

  private readonly STORAGE_RECORD_KEY = 'PsEncrypt:LastUsedEncryptionTable';

  /**
   * Constructor
   */
  constructor(
    private readonly _httpClient: HttpClient,
    @Inject(ENCRYPTION_TABLES_SOURCE) private readonly _encryptionTablesSource: string
  ) { }

  // -------------------------------------------------------------------
  // @ Accessors
  // -------------------------------------------------------------------

  /**
   * Encryption tables observable
   */
  get encryptionTables$(): Observable<EncryptionTable[]> {
    return this._encryptionTables.asObservable();
  }
  set encryptionTables(value: EncryptionTable[]) {
    this._encryptionTables.next(value);
    this._encryptionTablesLoaded = !!value;
  }

  /**
   * Encryption map observable
   */
  get encrytionMap$(): Observable<EncryptionMap> {
    return this._encryptionMap.asObservable();
  }
  set encryptionMap(value: EncryptionMap) {
    this._encryptionMap.next(value);
  }

  /**
   * Selected encryption table observable
   */
  get selectedEncrytionTable$(): Observable<EncryptionTable | null> {
    return this._selectedEncryptionTable.asObservable().pipe(distinctUntilChanged());
  }
  set selectedEncryptionTable(value: EncryptionTable) {
    localStorage.setItem(this.STORAGE_RECORD_KEY, JSON.stringify(value))
    this._selectedEncryptionTable.next(value);
  }

  /**
   * Last encryption table
   */
  get lastEncryptionTable(): EncryptionTable | null {
    if (!localStorage.getItem(this.STORAGE_RECORD_KEY)) return null;
    return JSON.parse(localStorage.getItem(this.STORAGE_RECORD_KEY)!)
  }

  // -------------------------------------------------------------------
  // @ Public methods
  // -------------------------------------------------------------------

  /**
   * Load available encryption tables
   */
  loadEncryptionTables(): Observable<EncryptionTable[]> {
    return iif(
      () => this._encryptionTablesLoaded,
      this.encryptionTables$.pipe(take(1)),
      this._httpClient.get<EncryptionTable[]>(this._encryptionTablesSource)
        .pipe(
          tap(tables => this.encryptionTables = tables),
          tap((tables) => {
            if (this.lastEncryptionTable) {
              this.selectedEncryptionTable = this.lastEncryptionTable;
              return;
            }
            const defaultSelectedTable = tables.find(table => table.default) ?? tables.at(0);
            if (defaultSelectedTable) this.selectedEncryptionTable = defaultSelectedTable;
          })
        )
    );
  }

  /**
   * Load database references as a name => encryptedName map
   *
   * @param encryptionTable
   */
  loadReferences(encryptionTable?: string): Observable<EncryptionMap> {
    const encryptionTableName = encryptionTable ?? this._selectedEncryptionTable.getValue()?.name ?? '';
    if (!encryptionTableName) throwError(() => new Error(`Can not find encryption table with name ${encryptionTableName}`));
    return iif(
      () => !!this._encryptionMapCache.get(encryptionTableName),
      of(this._encryptionMapCache.get(encryptionTableName)!),
      this.encryptionTables$.pipe(
        take(1),
        switchMap((encryptionTables) => {
          const table = encryptionTables.find(table => table.name === encryptionTableName);
          if (!table) return throwError(() => new Error(`Can not find encryption table with name ${encryptionTableName}`))
          return this._httpClient.get<EncryptionMapJsonSchema>(table.url)
            .pipe(
              map(({ tables, columns }) => ({
                tables: new Map(Object.entries(tables)),
                columns: new Map(Object.entries(columns).map(([key, value]) => [key, new Map(Object.entries(value))]))
              })),
              tap(result => this.encryptionMap = result),
              tap(result => this._encryptionMapCache.set(encryptionTableName, result)),
              tap(() => this.selectedEncryptionTable = table)
            );
        })
      )
    );
  }

  /**
   * Encrypt the given source using the loaded encryption map
   *
   * @param source
   */
  encrypt(source: string): Observable<string> {
    return this.loadReferences()
      .pipe(
        switchMap((encryptionMap) => {

          let result = source;

          // Encrypt tablenames
          encryptionMap.tables.forEach((tableEncryptedName, tableName) => {
            const removeWordRegex = new RegExp(`\\b${tableName}\\b`, 'g')
            result = result.replaceAll(removeWordRegex, tableEncryptedName);
          });

          /**
           * Keep track of tables containing a given column name
           * This increases lookup performance as every lookup is performed only once
           * { [Original column name] => [table1, table2, ...] }
           * */
          const columnsTablesCacheMap = new Map<string, string[]>();

          /**
           * Keep track of tables containing a given column name
           * This increases lookup performance as every lookup is performed only once
           * { [Original column name] => [table1, table2, ...] }
           * */
          const columnsLookupCacheMap = new Map<string, boolean>();

          const tableAliases = new Map<string, string>();

          const aliasRegex = /\b(?:FROM|JOIN)\s+(\w+|\#\w+)\s+AS\s+(\w+)|\b(?:FROM|JOIN)\s+(\w+|\#\w+)\s+(\w+)\b/g;

          // const aliasRegex = /\b(?:FROM|JOIN)\s+(\w+|\#\w+)(?:\s+AS\s+(\w+))?|\b(?:WHERE|AND|OR)\s+(\w+|\#\w+)\b/g;

          let match;
          while ((match = aliasRegex.exec(result)) !== null) {
            const tableAlias = match[2] || match[4];
            const encryptedTableName = match[1] || match[3];
            if (tableAlias && encryptedTableName) {
              tableAliases.set(tableAlias, encryptedTableName);
              tableAliases.set(encryptedTableName, encryptedTableName); // Because tableName is always a valid alias of tableName
            }
          }

          // Encrypt columns
          encryptionMap.columns.forEach((tableEncryptedColumnsMap) => {

            for (const [originalColumnName] of tableEncryptedColumnsMap.entries()) {

              let wordPresenceTest = columnsLookupCacheMap.get(originalColumnName);
              const originalColumnNameWord = new RegExp(`(?<!@)\\b${originalColumnName}\\b`, 'g');

              if (wordPresenceTest === undefined) {
                // Check if column name is in the source
                wordPresenceTest = originalColumnNameWord.test(result);
                columnsLookupCacheMap.set(originalColumnName, wordPresenceTest);
              }
              // We already treated this case so next
              else {
                continue
              }

              if (!wordPresenceTest) {
                continue;
              }

              // Our first try is to use absolute reference to encrypt column
              // This is considered the easiest case (tableAlias.column)
              let unresolvableTableAlias = false;
              let columnReferenceIsAbsolute = false;
              for (const [tableAlias, aliasTableReference] of tableAliases.entries()) {
                const columnAliasRegex = new RegExp(`\\b${tableAlias}\.${originalColumnName}\\b`, 'g');
                const columnAliasTest = columnAliasRegex.test(result);
                if (columnAliasTest) {
                  unresolvableTableAlias = !encryptionMap.columns.get(aliasTableReference)?.get(originalColumnName);
                  if (!unresolvableTableAlias) {
                    result = result.replace(
                      columnAliasRegex,
                      `${tableAlias}.${encryptionMap.columns.get(aliasTableReference)?.get(originalColumnName) ?? originalColumnName}`
                    );
                  }
                  columnReferenceIsAbsolute = columnReferenceIsAbsolute && !originalColumnNameWord.test(`${result}`.replace(columnAliasRegex, ''));
                }
              }

              // If column is only referenced using an absolute path in source, all its cases have been treated at this point
              // if (columnReferenceIsAbsolute) {
              //   continue;
              // }

              // No need to go further if the current word has been fully encrypted
              // if (tableAliases.size && !new RegExp(`\\b(\w+)\.${originalColumnName}\\b`, 'g').test(result)) {
              //   continue;
              // }

              // Look for all tables having column name among its columns
              // These are considered first step candidates
              const columnsTables = columnsTablesCacheMap.get(originalColumnName) ??
                Array.from(encryptionMap.tables.keys())
                  .map(element => [element])
                  .reduce((previousResult, currentElement) => {
                    const currentEncryptedTableName = encryptionMap.tables.get(currentElement[0])!;
                    if (encryptionMap.columns.get(currentEncryptedTableName)?.has(originalColumnName)) {
                      return [...previousResult, ...currentElement];
                    }
                    return previousResult;
                  }, []);

              // Filter the first candidates by checking if they are found in the source or not
              // This makes second order candidates
              const columnsTablesInSource = columnsTables.filter(table => new RegExp(`\\b${table}\\b`, 'g').test(source) ||
                new RegExp(`\\b${encryptionMap.tables.get(table)}\\b`, 'g').test(source));

              // Unique column name
              // This means there is only one table referenced in the source that has a column named originalColumnName
              if (columnsTablesInSource.length === 1) {
                result = result.replaceAll(
                  new RegExp(`(?<!@)\\b${originalColumnName}\\b`, 'g'), // At this point all aliases are supposed handled
                  encryptionMap.columns
                    .get(
                      encryptionMap.tables.get(columnsTablesInSource[0])!
                    )!
                    .get(originalColumnName)!
                );
              }

              // There are many valid candidates in source having a column named originalColumnName
              // Obviously it becomes difficult to select the right option at this point because our
              // encryption motor is dumb and does not know much about TSQL.
            }

          });

          return of(result);
        })
      );
  }

  /**
   * Decrypt the given source using the loaded encryption map
   *
   * @param source
   */
  decrypt(source: string): Observable<string> {
    return this.loadReferences()
      .pipe(
        switchMap((encryptionMap) => {

          let result = source;

/*          encryptionMap.tables.forEach((tableEncryptedName, tableName) => {
            const removeWordRegex = new RegExp(`\\b${tableEncryptedName}\\b`, 'g')
            result = result.replaceAll(removeWordRegex, tableName);
          });*/

          // Encrypt columns
          encryptionMap.columns.forEach((tableEncryptedColumnsMap) => {

            let encrypted;
            for (const [originalColumnName, encryptedColumnName] of tableEncryptedColumnsMap.entries()) {
              const encryptedColumnNameWord = encryptedColumnName;

              encrypted = encryptedColumnNameWord;
              let concat = originalColumnName.concat("_",encryptedColumnNameWord)
              result = result.replaceAll(encryptedColumnName, concat)
            }

          });



          return of(result);
        })
      );
  }

  /**
   * Check if a string input is correctly encrypted
   *
   * This simply implies that no original word belonging to encryption map
   * is a substring of the input
   *
   * @param input
   * @param options
   */
  check(input: string, { includeUnencryptedWords }: { includeUnencryptedWords?: boolean } = {}): Observable<EncryptionVerificationResult> {

    if (!input) return includeUnencryptedWords ? of({ result: true, unencryptedWords: [] }) : of(true);

    return this.loadReferences()
      .pipe(
        switchMap((encryptionMap) => {

          const unencryptedWords: string[] = [];

          let result = true;

          // No original table name in input
          for (const originalTableName of encryptionMap.tables.keys()) {
            if (includeUnencryptedWords && unencryptedWords.includes(originalTableName)) continue;
            const originalTableNameWord = new RegExp(`\\b${originalTableName}\\b`, 'g');
            const wordPresenceTest = originalTableNameWord.test(input);
            if (includeUnencryptedWords && wordPresenceTest) unencryptedWords.push(originalTableName);
            result = result && !wordPresenceTest;
            if (!result && !includeUnencryptedWords) return of(result);
          }

          // No original column name in input
          for (const columnsEncryptionMap of encryptionMap.columns.values()) {
            for (const [originalColumnName] of columnsEncryptionMap) {
              if (includeUnencryptedWords && unencryptedWords.includes(originalColumnName)) continue;
              const originalColumnNameWord = new RegExp(`(?<!@)\\b${originalColumnName}\\b`, 'g');
              const wordPresenceTest = originalColumnNameWord.test(input);
              if (includeUnencryptedWords && wordPresenceTest) unencryptedWords.push(originalColumnName);
              result = result && !wordPresenceTest;
              if (!result && !includeUnencryptedWords) return of(result);
            }
          }

          return includeUnencryptedWords ? of({ result, unencryptedWords }) : of(result);
        })
      );
  }

  /**
   * Selects an encryption table
   *
   * @param encryptionTableName
   */
  select(encryptionTableName: string): Observable<EncryptionTable> {
    return this.encryptionTables$.pipe(
      take(1),
      switchMap((tables) => {
        const encryptionTable = tables.find(table => table.name === encryptionTableName);
        if (!encryptionTable) {
          return throwError(() => new Error(`Can not find encryption table with name ${encryptionTableName}`))
        };
        return of(encryptionTable);
      }),
      tap(selectedEncryptionTable => this.selectedEncryptionTable = selectedEncryptionTable)
    )
  }
}
