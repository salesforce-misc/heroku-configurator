import {APIClient, Command, flags} from '@heroku-cli/command'
import * as Heroku from '@heroku-cli/schema'
import {CliUx} from '@oclif/core'
import {detailedDiff} from 'deep-object-diff'
import {RootConfigType} from '../../lib/config'
import {table} from 'table'
import {color} from '@heroku-cli/color'
import {loadConfig, retry} from '../../lib/cli'
import {HTTP} from 'http-call'

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
  updated: string[][],
  deleted: string[][]
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
    if (app in diff.updated || app in diff.added || app in diff.deleted) {
      const updated: string[][] = []
      for (const key in diff.updated[app]) {
        updated.push([key, diff.updated[app][key], current[app][key]])
      }

      const added: string[][] = []
      for (const key in diff.added[app]) {
        added.push([key, diff.added[app][key]])
      }

      const deleted: string[][] = []
      for (const key in diff.deleted[app]) {
        deleted.push([key])
      }

      formattedDiffs.push({
        name: app,
        added: added,
        updated: updated,
        deleted: deleted,
      })
    }
  }

  return formattedDiffs
}

function outputDiffs(diffs: DiffByApp): void {
  console.log('The following changes have been detected:\n')
  for (const app of diffs) {
    if (app.added.length == 0 && app.updated.length == 0 && app.deleted.length == 0) continue;

    CliUx.ux.styledHeader(`App: ${app.name}`)
    if (app.added.length > 0) {
      console.log('Added:')
      console.log(table(
        [['Variable', 'Value'], ...app.added]
      ))
    }

    if (app.updated.length > 0) {
      console.log('Updated:')
      console.log(table(
        [['Variable', 'New value', 'Current value'], ...app.updated] 
      ))
    }

    if (app.deleted.length > 0) {
      console.log('Deleted:')
      ux.log(table(
        [['Variable'], ...app.deleted]
      ))
    }
  }
}

async function shouldApplyDiffs(): Promise<boolean> {
  return await ux.confirm('Apply these changes?')
}

async function apply(diffs: Diff, client: APIClient): Promise<void> {
  const patchesByApp: Record<string, Record<string, string|null>> = {}

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

  if (diffs.deleted) {
    for (const appKey in diffs.deleted) {
      if (!patchesByApp[appKey]) patchesByApp[appKey] = {}
      for (const configKey in diffs.deleted[appKey]) {
        patchesByApp[appKey][configKey] = null;
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
  }
}

type AppResponse = {
  app: string,
  resp: HTTP<unknown>
}

export async function fetchConfigs(apps: string[], client: APIClient): Promise<Record<string, Heroku.ConfigVars>> {
  const appConfigs: Record<string, Heroku.ConfigVars> = {}

  const promises = apps.map(app => {
    return new Promise<AppResponse>((resolve, reject) => {
      client.get(`/apps/${app}/config-vars`)
      .then((resp) => resolve({app: app, resp: resp}))
      .catch((err) => reject(err))
    })
  });

  await Promise.all(promises)
  .then(responses => {
    responses.map((appResp) => {
      appConfigs[appResp.app] = typeof appResp.resp.body == 'string' ? JSON.parse(<string>appResp.resp.body) : appResp.resp.body;
    })
  })
  return Promise.resolve(appConfigs);
}

export default class Apply extends Command {
  static description = 'Applies the configuration to the defined applications.'
  static flags = {
    path: flags.string({char: 'f', description: 'Path to the config file.', required: true}),
    app: flags.string({char: 'a', description: 'Single app to apply changes to.', required: false}),
    dryrun: flags.boolean({char: 'd', description: 'Dry run, don\'t apply changes', required: false}),
    nodelete: flags.boolean({description: 'Do not delete config keys', required: false})
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
    const currentConfig = <Record<string, Heroku.ConfigVars>>await fetchConfigs(apps, this.heroku).catch((err) => ux.error(err));

    const diffs = <Diff>detailedDiff(currentConfig, expectedConfig);
    // remove deletions from diffs that have been marked as remote config
    if (!flags.nodelete) {
      for (const app of apps.filter((app) => app in diffs.deleted)) {
        for (const key in diffs.deleted[app]) {
          if (loadedConfig.apps[app].remote_config.indexOf(key) > -1) {
            delete diffs.deleted[app][key]
          }
        }
        if (Object.keys(diffs.deleted[app]).length === 0) delete diffs.deleted[app]
      }
    } else {
      for (const app of apps.filter((app) => app in diffs.deleted)) {
        delete diffs.deleted[app];
      }
    }
    const numUpdates = Object.keys(diffs.updated).map((key): number => Object.keys(diffs.updated[key]).length).reduce((prev, cur) => prev + cur, 0)
    if (numUpdates === 0 && Object.keys(diffs.added).length === 0 && Object.keys(diffs.deleted).length === 0) {
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
