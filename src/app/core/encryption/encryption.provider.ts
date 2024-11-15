import { APP_INITIALIZER, EnvironmentProviders, Provider, importProvidersFrom } from "@angular/core";
import { EncryptionService } from "./encryption.service";
import { MAT_SNACK_BAR_DEFAULT_OPTIONS, MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'
import { catchError, of } from "rxjs";
import { ENCRYPTION_TABLES_SOURCE } from "./encryption.constants";

export const provideEncryption = (encryptionTablesSource: string): Array<Provider | EnvironmentProviders> => [
  EncryptionService,
  importProvidersFrom(MatSnackBarModule),
  {
    provide: APP_INITIALIZER,
    useFactory: (encryptionService: EncryptionService, snackBar: MatSnackBar) =>
      () => encryptionService
        .loadEncryptionTables()
        .pipe(
          catchError(() => {
            snackBar.open('Failed to load encryption tables ! Check application config or contact support !');
            return of({})
          })
        ),
    deps: [EncryptionService, MatSnackBar],
    multi: true
  },
  {
    provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
    useValue: { horizontalPosition: 'right', verticalPosition: 'top' }
  },
  {
    provide: ENCRYPTION_TABLES_SOURCE,
    useValue: encryptionTablesSource
  }
]
