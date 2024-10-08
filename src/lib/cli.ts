import { RootConfigType, load } from "./config";
import * as errors from '../lib/errors'
import { CliUx } from "@oclif/core";

const ux = CliUx.ux;

export async function loadConfig(path: string): Promise<RootConfigType> {
  return <RootConfigType>await load(path).catch((err) => {
    switch (err.constructor) {
      case errors.InvalidConfigurationError: ux.error(`Invalid configuration: ${err.path}`); break;
      case errors.FileDoesNotExistError: ux.error(`Config file (${path}) does not exist`); break;
    }
  });
}

export async function retry(func: () => Promise<void>, prompt: () => Promise<boolean> = () => Promise.resolve(true), maxAttempts = 3): Promise<void> {
  let attempt = 0
  while (++attempt <= maxAttempts) {
    if(await prompt()) {
      try {
        await func()
      } catch(err) {
        return Promise.reject(err)
      }
      return Promise.resolve()
    }
  }
  return Promise.reject(new errors.RetryError())
}