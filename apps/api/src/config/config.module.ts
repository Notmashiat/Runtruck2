import { Global, Module } from '@nestjs/common';
import { apiEnvSchema, parseEnv, type ApiEnv } from '@runtruck/config';

export const API_ENV = Symbol('API_ENV');

// Validated environment, loaded once at boot. The process refuses to start with
// a missing or malformed variable rather than failing later mid-request.
@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: (): ApiEnv => parseEnv(apiEnvSchema) }],
  exports: [API_ENV],
})
export class ConfigModule {}
