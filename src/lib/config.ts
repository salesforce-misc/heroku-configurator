import {parse} from 'yaml'
import * as fs from 'fs'
import {z} from 'zod'
import * as path from 'path'
import * as errors from '../lib/errors'

// TODO: could probably add some constraints to these
const ConfigBlockSchema = z.object({
  config: z.record(z.string(), z.string().or(z.number()).or(z.boolean())).default({}),
  remote_config: z.array(z.string()).default([])
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
  if (!configObj.include) return Promise.resolve();

  const promises: Promise<ExternalConfigType>[] = [];
  configObj.include.map(include => {
    promises.push(<Promise<ExternalConfigType>>load(path.join(configDir, include.params.path), ExternalConfigSchema))
  });

  await Promise.all(promises)
  .then(externalConfigs => {
    externalConfigs.map(externalConfig => {
      for (const app in configObj.apps) {
        const currentApp = configObj.apps[app];

        if (!currentApp.include) continue;
        for (const appInclude of currentApp.include) {
          const [name, block] = appInclude.split('.')
          if (name !== externalConfig.name) continue;

          if (block in externalConfig) {
            for (const configKey in externalConfig[block as keyof typeof externalConfig].config) {
              if (!(configKey in currentApp.config)) currentApp.config[configKey] = externalConfig[block].config[configKey]
            }
          }
        }
      }
    })
  })
  Promise.resolve();
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
              currentApp.config[configKey] = configObj.locals[include].config[configKey]
            }
          }
        }
      }
    }
  }
}

// TODO: would probably be best to break this up between loading root and external configs
export async function load(filePath: string, expectedSchema: z.ZodType = RootConfigSchema): Promise<RootConfigType | ExternalConfigType> {
  let data = '';
  try {data = await fs.promises.readFile(filePath, 'utf8')}
  catch (err) {throw new errors.FileDoesNotExistError(filePath)}

  let configObj: RootConfigType | ExternalConfigType;
  configObj = parse(data)

  try {configObj = expectedSchema.parse(configObj)}
  catch (err) { throw new errors.InvalidConfigurationError(filePath); }

  const configDir = path.dirname(path.resolve(filePath));

  if (expectedSchema === RootConfigSchema) {
    // order is important. locals should take higher priority than externally loaded config.
    applyLocals(<RootConfigType>configObj)
    await applyExternalIncludes(<RootConfigType>configObj, configDir);
  }
  return Promise.resolve(configObj);
}