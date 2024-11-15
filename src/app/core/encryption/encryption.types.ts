/**
 * [Original Table name] => [Encrypted Table name]
 */
export type TableEncryptionMap = Map<string, string>;
/**
 * [Original Table name] => { [Original Column name] => [Encrypted Column name] }
 */
export type ColumnEncryptionMap = Map<string, Map<string, string>>;

export type EncryptionMap = { tables: TableEncryptionMap; columns: ColumnEncryptionMap };
export type EncryptionMapJsonSchema = { tables: Record<string, string>; columns: Record<string, Record<string, string>> };

export type EncryptionVerificationMarch = { result: boolean; unencryptedWords?: string[] };
export type EncryptionVerificationResult = boolean | EncryptionVerificationMarch;

export type EncryptionTable = { name: string; url: string; default?: boolean; }
