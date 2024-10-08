import { APIClient, Command, flags } from "@heroku-cli/command"
import { loadConfig, retry } from "../../../lib/cli"
import * as errors from '../../../lib/errors'
import {z} from 'zod'
import { ux } from "@oclif/core/lib/cli-ux"
import { color } from '@heroku-cli/color'
import {table} from 'table'
import {HTTPError, HTTP} from 'http-call'
import { HerokuAPIError } from "@heroku-cli/command/lib/api-client"

const CollaboratorsResponseSchema = z.array(
  z.object({
    app: z.object({name: z.string()}),
    permissions: z.array(z.object({name: z.string()})),
    user: z.object({email: z.string()})
  })
)
type CollaboratorsByApp = Record<string, Record<string, string[]>>
type CollaboratorsResponseType = z.infer<typeof CollaboratorsResponseSchema>

type AppResponse = {
  app: string,
  resp: HTTP<unknown>
}

async function getCollaborators(apps: string[], client: APIClient): Promise<CollaboratorsByApp> {
  const collaboratorsByApp: CollaboratorsByApp = {};
  apps.map((app) => collaboratorsByApp[app] = {})

  const promises = apps.map((app) => {
    return new Promise<AppResponse>((resolve, reject) => {
      client.get(`/teams/apps/${app}/collaborators`)
      .then((resp) => resolve({app: app, resp: resp}))
      .catch((err) => reject(err))
    })
  });
  await Promise.all(promises)
  .then((responses) => {
    responses.map((appResp) => {
      // resp.body typecheck is needed it seems due to changes between node versions
      const collaborators = <CollaboratorsResponseType>CollaboratorsResponseSchema.parse(
        (typeof appResp.resp.body == 'string' ? JSON.parse(<string>appResp.resp.body) : appResp.resp.body)
      );
      for (const collaborator of collaborators) {
        collaboratorsByApp[appResp.app][collaborator.user.email] = collaborator.permissions.map((permObj => permObj.name));
        collaboratorsByApp[appResp.app][collaborator.user.email].sort();
      }
    })
  })
  return Promise.resolve(collaboratorsByApp)
}

type PermissionChange = {
  collaborator: string,
  expected: string[],
  current?: string[]
}

function getPermissionsToChange(apps: string[], collaboratorsToUpdate: string[], currentCollaboratorsByApp: CollaboratorsByApp, expectedPerms: string[]): [Record<string, PermissionChange[]>, Record<string, PermissionChange[]>]
{
  const updates: Record<string, PermissionChange[]> = {};
  const adds: Record<string, PermissionChange[]> = {};

  for (const app of apps) {
    for (const col of collaboratorsToUpdate) {
      const currentPerms = currentCollaboratorsByApp[app][col];

      if (!(col in currentCollaboratorsByApp[app])) {
        if (!adds[app]) adds[app] = []; // only add if there's something to do
        adds[app].push({collaborator: col, expected: expectedPerms});
      } else if (
          expectedPerms.filter((val) => !currentPerms.includes(val)).length > 0 ||
          currentPerms.filter((val) => !expectedPerms.includes(val)).length > 0) {
        if (!updates[app]) updates[app] = []; // only add if there's something to do
        updates[app].push({collaborator: col, current: currentPerms, expected: expectedPerms});
      }
    }
  }
  return [adds, updates];
}

function outputChanges(apps: string[], adds: Record<string, PermissionChange[]>, updates: Record<string, PermissionChange[]>): void {
  for (const app of apps) {
    if (!(app in adds || app in updates)) continue;

    ux.styledHeader(app)

    if (app in adds) {
      ux.log(color.bold('Adding'))
      ux.log(table(
        [['Collaborator', 'Permissions'], ...adds[app].map((add) => [add.collaborator, add.expected])]
      ));
    }

    if (app in updates) {
      ux.log(color.bold('Updating'))
      ux.log(table(
        [['Collaborator', 'Current permissions', 'New permissions'], ...updates[app].map((update) => [update.collaborator, update.current, update.expected])]
      ))
    }
  }
}

async function shouldApplyChanges(apps: string[], adds: Record<string, PermissionChange[]>, updates: Record<string, PermissionChange[]>): Promise<boolean> {
  ux.log(`The following changes were detected:\n`)
  outputChanges(apps, adds, updates)
  return await ux.confirm('Apply these changes?')
}

async function apply(apps: string[], adds: Record<string, PermissionChange[]>, updates: Record<string, PermissionChange[]>, client: APIClient): Promise<void> {
  for (const app of apps.filter((app) => app in adds || app in updates)) {
    await retry(async(): Promise<void> => {
      const promises = [
        ...app in adds ? adds[app].map((add) => client.post(`/teams/apps/${app}/collaborators`, {body: {user: add.collaborator, permissions: add.expected}})) : [],
        ...app in updates ? updates[app].map((update) => client.patch(`/teams/apps/${app}/collaborators/${update.collaborator}`, {body: {permissions: update.expected}})) : []
      ]

      try {await Promise.all(promises)}
      catch(err) {return Promise.reject(err)}
      return Promise.resolve()
    }, async (): Promise<boolean> => {
      if (await ux.prompt(`Type ${app} to apply changes`) == app) return Promise.resolve(true)
      return Promise.resolve(false)
    }).catch((err) => {
      switch(err.constructor) {
        case errors.RetryError: ux.log(`Max attempts exceeded, skipping ${app}`); break;
        case HTTPError:
          // fall through. it'll be HTTPError in tests but HerokuAPI when invoked through the CLI
        case HerokuAPIError: {
          ux.warn(`${err.message}`);
          ux.warn(`Skipping ${app}`)
          break;
        }
      }
    })
  }
}

export default class UpdateAccess extends Command {
  static description = 'Update collaborator access to the defined set of applications.'
  static flags = {
    path: flags.string({char: 'f', description: 'Path to the config file.', required: true}),
    app: flags.string({char: 'a', description: 'Single app to apply changes to.', required: false}),
    permissions: flags.string({char: 'p', required: true, description: 'Comma-delimited list of permissions to apply to the collaborator(s)'})
  }

  static args = [
    {
      name: 'collaborators',
      description: 'A comma-delimited list of collaborator email addresses to apply the updates to',
      required: true
    }
  ]

  async run(): Promise<void> {
    const {flags, argv} = this.parse(UpdateAccess)
    const loadedConfig = await loadConfig(flags.path)

    const collaboratorsToUpdate = argv[0].split(',')
    const expectedPerms = flags.permissions.split(',').map(perm => perm.trim())
    expectedPerms.sort();

    let apps = Object.keys(loadedConfig.apps)
    apps.sort()

    if (flags.app) {
      if (!apps.includes(flags.app)) ux.error(`App ${color.app(flags.app)} is not in configured apps`)
      apps = [flags.app];
    }
    let currentCollaboratorsByApp: CollaboratorsByApp = {}
    currentCollaboratorsByApp = await getCollaborators(apps, this.heroku)

    const [adds, updates] = getPermissionsToChange(apps, collaboratorsToUpdate, currentCollaboratorsByApp, expectedPerms)
    if (Object.keys(adds).length == 0 && Object.keys(updates).length == 0) {
      ux.log('No changes detected, exiting.')
      return Promise.resolve()
    }

    if (await shouldApplyChanges(Object.keys(loadedConfig.apps), adds, updates)) {
      // this will result in a 404 if it's not a teams app
      await apply(apps, adds, updates, this.heroku)
      ux.log('Permissions updates applied successfully')
    }
  }
}