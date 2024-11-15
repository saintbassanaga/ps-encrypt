import { ApplicationConfig } from '@angular/core';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withPreloading } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideCore } from './core/core.provider';

export const appConfig: ApplicationConfig = {
  providers: [

    // Router
    provideRouter(
      routes,
      withComponentInputBinding(),
      withPreloading(PreloadAllModules)
    ),

    // Angular animations
    provideAnimations(),

    // Core modules
    provideCore({
      encryptionTablesSource: 'assets/datasets/encryption_tables.json'
    }),

    // Angular Material defaults
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: {
        appearance: 'outline'
      }
    }
  ]
};
