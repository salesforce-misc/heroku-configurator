import {parse} from 'yaml'
import {readFile} from 'node:fs'
import {z} from 'zod'
import * as Heroku from '@heroku-cli/schema'
import {APIClient} from '@heroku-cli/command'
import * as path from 'path'

// TODO: could probably add some constraints to these
const ConfigBlockSchema = z.object({
  config: z.record(z.string(), z.string().or(z.number()).or(z.boolean())).default({}),
})
const ExternalConfigSchema = z.object({
  name: z.string(),
})
.catchall(ConfigBlockSchema)

const ApplicationConfigSchema = z.object({
  include: z.optional(z.array(z.string())),
})
.extend(ConfigBlockSchema.shape)

const RootIncludeFileSchema = z.object({
  path: z.string(),
})

const RootIncludeSchema = z.object({
  type: z.string(),
  params: RootIncludeFileSchema,
})

const RootConfigSchema = z.object({
  name: z.string(),
  include: z.optional(z.array(RootIncludeSchema)),
  locals: z.optional(z.record(z.string(), ConfigBlockSchema)),
  apps: z.record(z.string(), ApplicationConfigSchema),
})

export type RootConfigType = z.infer<typeof RootConfigSchema>;
export type ExternalConfigType = z.infer<typeof ExternalConfigSchema>;

async function applyExternalIncludes(configObj: RootConfigType, configDir: string) : Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (configObj.include) {
      const promises: Promise<void>[] = []

      // run through each of the external config files and copy the included blocks into each of the app's configs.
      // this could be a whole lot smarter and have a bunch more error checking but at this point i've had it
      // with hacking my way around the type system so i don't care enough to. i'll probably revisit it at some point once
      // i've learned more about the type system. just concentrating on the happy path for now.
      for (const inc of configObj.include) {
        const promise = (<Promise<ExternalConfigType>>load(path.join(configDir, inc.params.path), ExternalConfigSchema))
        .then(externalConfig => {
          for (const appKey in configObj.apps) {
            const appConfig = configObj.apps[appKey as keyof typeof configObj.apps]
            if (!appConfig.include) continue

            for (const appInclude of appConfig.include) {
              const [name, block] = appInclude.split('.')
              if (name == externalConfig.name && externalConfig[block as keyof typeof externalConfig]) {
                for (const configKey in externalConfig[block as keyof typeof externalConfig].config) {
                  if (!(configKey in appConfig.config)) {
                    appConfig.config[configKey] = externalConfig[block].config[configKey]
                  }
                }
              }
            }
          }
        }).catch(error => {
          reject(error)
        })
        promises.push(promise)
      }

      Promise.all(promises)
      .then(() => {
        resolve()
      }).catch(error => {
        reject(error)
      })
    } else {
      resolve()
    }
  })
}

function applyLocals(configObj: RootConfigType): void {
  for (const app in configObj.apps) {
    const currentApp = configObj.apps[app]
    if (currentApp.include) {
      for (const include of currentApp.include) {
        if (!include.includes('.') && configObj.locals) {
          if (!(include in configObj.locals)) throw new Error(`Unknown locals include '${include}' in app ${app}`)
          for (const configKey in configObj.locals[include].config) {
            // don't stomp existing config
            if (!(configKey in currentApp.config)) {
            //if (!(configKey in currentApp.config)) {
              currentApp.config[configKey] = configObj.locals[include].config[configKey]
            }
          }
        }
      }
    }
  }
}

export async function fetchConfig(app: string, client: APIClient): Promise<Heroku.ConfigVars> {
  return new Promise<Heroku.ConfigVars>((resolve, reject) => {
    client.get(`/apps/${app}/config-vars`)
    .then(resp => {
      resolve(<Promise<Heroku.ConfigVars>>resp.body)
    }).catch(error => {
      reject(error)
    })
  })
}

export async function fetchConfigs(apps: string[], client: APIClient): Promise<Record<string, Heroku.ConfigVars>> {
  return new Promise<Record<string, Heroku.ConfigVars>>((resolve, reject) => {
    const appConfigs: Record<string, Heroku.ConfigVars> = {}
    const promises: Promise<void>[] = []

    for (const app of apps) {
      const promise = new Promise<void>((res, rej) => {
        fetchConfig(app, client)
        .then(config => {
          appConfigs[app] = config
          res()
        }).catch(error => {
          rej(error)
        })
      })

      promises.push(promise)
    }

    Promise.all(promises)
    .then(() => {
      resolve(appConfigs)
    }).catch(error => {
      reject(error)
      return
    })
  })
}

export async function load(filePath: string, expectedSchema: z.ZodType = RootConfigSchema): Promise<RootConfigType | ExternalConfigType> {
  return new Promise<RootConfigType | ExternalConfigType>((resolve, reject) => {
    readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        reject(err)
        return
      }

      let configObj: RootConfigType
      try {
        configObj = parse(data)
      } catch (error) {
        reject(error)
        return
      }

      try {
        configObj = expectedSchema.parse(configObj)
      } catch (error) {
        reject(new Error(`Invalid configuration: ${filePath}\n${(<Error>error).message}`))
        return
      }

      const configDir = path.dirname(path.resolve(filePath));
      // order is important. locals should take higher priority than externally loaded config.
      try {
        applyLocals(configObj)
      } catch(err) {
        reject(err); return;
      }
      applyExternalIncludes(configObj, configDir)
      .then(() => resolve(configObj))
      .catch(error => {
        reject(error)
      })
    })
  })
}
