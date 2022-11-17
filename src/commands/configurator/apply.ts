import {APIClient, Command, flags} from '@heroku-cli/command'
import * as Heroku from '@heroku-cli/schema'
import {CliUx} from '@oclif/core'
import {detailedDiff} from 'deep-object-diff'
import {RootConfigType, fetchConfigs} from '../../lib/config'
import {table} from 'table'
import {color} from '@heroku-cli/color'
import * as errors from '../../lib/errors'
import { loadConfig, retry } from '../../lib/cli'

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

function normalizeExpectedConfig(apps: string[], config: RootConfigType): NormalizedConfigType {
  const expectedConfig: NormalizedConfigType = {}
  for (const appName of apps) {
    expectedConfig[appName] = {}
    for (const configKey in config.apps[appName].config) {
      expectedConfig[appName][configKey] = String(config.apps[appName].config[configKey])
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
    if (app.added.length == 0 && app.updated.length == 0) continue;

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
    await retry(async (): Promise<void> => {
      ux.log(`Applying config for ${appKey}`)
      try {
        await client.patch(`/apps/${appKey}/config-vars`, {body: patchesByApp[appKey]})
        ux.log('Config successfully applied')
        return Promise.resolve()
      } catch (err) {
        ux.warn(`Unable to apply config for ${color.app(appKey)}, continuing`)
        return Promise.resolve()
      }
    }, async (): Promise<boolean> => {
      if (await ux.prompt(`Type ${appKey} to apply changes`) == appKey) return Promise.resolve(true)
      return Promise.resolve(false)
    }).catch(() => ux.log(`Max attempts exceeded, skipping ${appKey}`))
    ux.log('Config application complete')
  }
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
    const loadedConfig = await loadConfig(flags.path);

    let apps = Object.keys(loadedConfig.apps)
    if (flags.app) {
      if (!(flags.app in loadedConfig.apps)) ux.error(`App ${color.app(flags.app)} is not in configured apps`)
      apps = [flags.app]
    }

    const expectedConfig = normalizeExpectedConfig(apps, loadedConfig);
    const currentConfig = <Record<string, Heroku.ConfigVars>>await fetchConfigs(apps, this.heroku).catch((err) => {
      if (err instanceof errors.AppNotFoundError) ux.error(`App ${color.app(err.app)} doesn't exist on Heroku`);
      ux.error(`Unknown error encountered when fetching config. Exiting.`)
    });

    const diffs = <Diff>detailedDiff(currentConfig, expectedConfig);
    const numUpdates = Object.keys(diffs.updated).map((key): number => Object.keys(diffs.updated[key]).length).reduce((prev, cur) => prev + cur, 0)
    if (numUpdates === 0 && Object.keys(diffs.added).length === 0) {
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
