import {APIClient, Command, flags} from '@heroku-cli/command'
import * as Heroku from '@heroku-cli/schema'
import {CliUx} from '@oclif/core'
import {detailedDiff, diff} from 'deep-object-diff'
import {load, RootConfigType, fetchConfigs} from '../../lib/config'
import {table} from 'table'

const ux = CliUx.ux;

type NormalizedConfigType = {
  [key: string]: Record<string, string>
}

type Diff = {
  added: Record<string, Heroku.ConfigVars>,
  deleted: Record<string, Heroku.ConfigVars>,
  updated: Record<string, Heroku.ConfigVars>
}

type DiffByApp = {
  name: string,
  added: string[][],
  updated: string[][]
}[];

function normalizeExpectedConfig(config: RootConfigType): NormalizedConfigType {
  const apps = (<RootConfigType>config).apps
  const expectedConfig: NormalizedConfigType = {}
  for (const appName in apps) {
    expectedConfig[appName] = {}
    for (const configKey in apps[appName].config) {
      expectedConfig[appName][configKey] = String(apps[appName].config[configKey])
    }
  }

  return expectedConfig
}

function formatDiffs(current: Record<string, Heroku.ConfigVars>, expected: Record<string, Heroku.ConfigVars>, diff: Diff): DiffByApp {
  const formattedDiffs: DiffByApp = []
  for (const app in expected) {
    if (app in diff.updated || app in diff.added) {
      const updated: string[][] = []
      for (const key in diff.updated[app]) {
        updated.push([key, diff.updated[app][key], current[app][key]])
      }

      const added: string[][] = []
      for (const key in diff.added[app]) {
        added.push([key, diff.added[app][key]])
      }

      formattedDiffs.push({
        name: app,
        added: added,
        updated: updated,
      })
    }
  }

  return formattedDiffs
}

function outputDiffs(diffs: DiffByApp): void {
  console.log('The following changes have been detected:\n')
  for (const app of diffs) {
    CliUx.ux.styledHeader(`App: ${app.name}`)
    if (app.added.length > 0) {
      console.log('Added:')
      console.log(table(
        [['Variable', 'Value'], ...app.added],
        {columnDefault: {width: 50}},
      ))
    }

    if (app.updated.length > 0) {
      console.log('Updated:')
      console.log(table(
        [['Variable', 'New value', 'Current value'], ...app.updated],
        {columnDefault: {width: 50}},
      ))
    }
  }
}

async function shouldApplyDiffs(): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    CliUx.ux.confirm('Apply these changes?')
    .then(rval => resolve(rval))
    .catch(error => reject(error))
  })
}

async function apply(diffs: Diff, client: APIClient): Promise<void> {
  const patchesByApp: Record<string, Record<string, string>> = {}
  if (diffs.added) {
    for (const appKey in diffs.added) {
      patchesByApp[appKey] = {}
      for (const configKey in diffs.added[appKey]) {
        patchesByApp[appKey][configKey] = diffs.added[appKey][configKey]
      }
    }
  }

  if (diffs.updated) {
    for (const appKey in diffs.updated) {
      if (!patchesByApp[appKey]) patchesByApp[appKey] = {}
      for (const configKey in diffs.updated[appKey]) {
        patchesByApp[appKey][configKey] = diffs.updated[appKey][configKey]
      }
    }
  }

  for (const appKey in patchesByApp) {
    let userResponse = ''
    let attempt = 0
    const maxAttempts = 3
    while (userResponse != appKey && ++attempt <= maxAttempts) {
      userResponse = await CliUx.ux.prompt(`Type ${appKey} to apply changes`)

      if (userResponse == appKey) {
        CliUx.ux.log(`Applying config for ${appKey}`)
        const resp = await client.patch(`/apps/${appKey}/config-vars`, {body: patchesByApp[appKey]})
        if (resp.statusCode == 200) {
          CliUx.ux.log('Config successfully applied')
        } else {
          CliUx.ux.log('Unable to apply config, continuing')
          continue
        }
      }
    }
    if (attempt >= maxAttempts) {
      CliUx.ux.log(`Max attempts exceeded, skipping ${appKey}`)
    }
  }
}

function trimConfigs(currentConfig: NormalizedConfigType, expectedConfig: NormalizedConfigType, app: string): [NormalizedConfigType, NormalizedConfigType] {
  // trim down in the event that an app is targeted
  const trimmedCurrentConfig: NormalizedConfigType = {};
  trimmedCurrentConfig[app] = currentConfig[app];

  const trimmedExpectedConfig: NormalizedConfigType = {};
  trimmedExpectedConfig[app] = expectedConfig[app];

  return [trimmedCurrentConfig, trimmedExpectedConfig];
}

export default class Apply extends Command {
  static description = 'Applies the configuration to the defined applications.'
  static flags = {
    path: flags.string({char: 'f', description: 'Path to the config file.', required: true}),
    app: flags.string({char: 'a', description: 'Single app to apply changes to.', required: false}),
    dryrun: flags.boolean({char: 'd', description: 'Dry run, don\'t apply changes', required: false})
  }

  async run(): Promise<void> {
    const {flags} = this.parse(Apply)

    const loadedConfig: RootConfigType = <RootConfigType>await load(flags.path);
    let expectedConfig = normalizeExpectedConfig(loadedConfig);
    let currentConfig = await fetchConfigs(Object.keys(loadedConfig.apps), this.heroku)

    if (flags.app) {
      if (!(flags.app in currentConfig)) return Promise.reject(new Error(`Unrecognized app ${flags.app}`));
      [currentConfig, expectedConfig] = trimConfigs(currentConfig, expectedConfig, flags.app);
    }

    const diffs = <Diff>detailedDiff(currentConfig, expectedConfig);
    if (Object.keys(diffs.updated).length === 0 && Object.keys(diffs.added).length === 0) {
      ux.log('No diffs found, exiting.')
      return Promise.resolve();
    }

    const formattedDiffs = formatDiffs(currentConfig, expectedConfig, diffs)
    outputDiffs(formattedDiffs);
    if (flags.dryrun) return Promise.resolve();

    if (await shouldApplyDiffs()) {
      await apply(diffs, this.heroku);
    } 
  }
}
