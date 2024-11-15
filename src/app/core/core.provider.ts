import { Provider, EnvironmentProviders } from "@angular/core";
import { provideEncryption } from "./encryption/encryption.provider";
import { provideHttpClient } from "@angular/common/http";

export const provideCore = (coreConfig: { encryptionTablesSource: string }): Array<Provider | EnvironmentProviders> => [

  // Http client
  provideHttpClient(),

  // Database encryption
  provideEncryption(coreConfig.encryptionTablesSource)

]
