# heroku-configurator

* [Installation](#installation)
* [Usage](#usage)
  * [configurator:apply](#configuratorapply)
  * [configurator:access:update](#configuratoraccessupdate)
* [Anatomy of configuration](#the-anatomy-of-configuration)

Declarative, composable configuration-as-code for services deployed to Heroku.

heroku-configurator is a Heroku CLI plugin that empowers developers with the ability to implement configuration as code to be applied to Heroku environments. This enables teams to follow a typical git (or other) source control review flow. With flexible configuration by composition built into the core of the plugin, complex service configurations can be broken up into logical chunks and applied to multiple apps and environments by simply including the desired block. The configurator plugin can be useful for single apps or complex service deployments over multiple apps in different pipeline stages.

heroku-configurator only concerns itself with additions and modifications to application configuration, not deletions. This is intentional. It allows teams to define sensitive configuration that should not be stored in source control (i.e. passwords) directly in the environments and not be stomped by heroku-configurator executions.

## Installation

```
$ git clone git@github.com:heroku/vaas-heroku-configurator.git
$ cd heroku-configurator
$ heroku plugins:link
```

## Usage
```
$ heroku help configurator
Environment-based configuration for the Heroku CLI

USAGE
  $ heroku configurator:COMMAND

TOPICS
  configurator:access  Manage access for environments

COMMANDS
  configurator:apply  Applies the configuration to the defined applications.
```

### configurator:apply

```
$ heroku help configurator:apply
Applies the configuration to the defined applications.

USAGE
  $ heroku configurator:apply

OPTIONS
  -a, --app=app    Single app to apply changes to.
  -d, --dryrun     Dry run, don't apply changes
  -f, --path=path  (required) Path to the config file.
```

Example:
```
$ heroku configurator:apply -f example/staging.yml 
The following changes have been detected:

=== App: configurator-staging

Updated:
╔══════════════════════╤════════════════╤═════════════════════════╗
║ Variable             │ New value      │ Current value           ║
╟──────────────────────┼────────────────┼─────────────────────────╢
║ DEBUG                │ true           │ false                   ║
╚══════════════════════╧════════════════╧═════════════════════════╝

Apply these changes?: 
```

If changes are detected, heroku-configurator will enumerate all additions and modifications across all apps defined in the config and then ask for confirmation as to whether or not they should be applied.

If the changes are to be applied, heroku-configurator will iterate over the list of apps to be updated and ask the user to input the application name to confirm:

```
Apply these changes?: y
Type configurator-staging to apply changes: 
```

Once all has been confirmed, configuration will have been applied to all Heroku applications.

### configurator:access:update

```
$ heroku help configurator:access:update
Update collaborator access to the defined set of applications.

USAGE
  $ heroku configurator:access:update COLLABORATORS

ARGUMENTS
  COLLABORATORS  A comma-delimited list of collaborator email addresses to apply the updates to

OPTIONS
  -a, --app=app                  Single app to apply changes to.
  -f, --path=path                (required) Path to the config file.
  -p, --permissions=permissions  (required) Comma-delimited list of permissions to apply to the collaborator(s)
```

Follows the identical confirmation flow as `configurator:apply`.

## The anatomy of configuration

There are two types of configuration files: Root and shared.

### Root config
```
name: <string>
include: <array>
  - type: <string>
    params:
      path: <string>
locals:
  <string>:
    config:
      <string>: <string|number|boolean>
apps:
  <string>:
    include: <array>
      - <string>
    config:
      <string>: <string|number|boolean>
```

* `name`: (required) Human-friendly name for the file. Could be a single app name or a description of the environment (i.e. dev, staging or prod)
* `include`: (optional) An array of objects describing what to include as shared configuration.
  * `type`: (required) `file` is the only type currently supported
  * `params`: (required) A `type`-specific set of parameters to pass to the include machinery. Currently only supports `path`, which is relative to the root config file.
* `locals`: (optional) Defines shared configuration at file scope.
* `apps`: (required) An object with application names as keys, containing configuration parameters. Note that the application names _must_ match Heroku app names exactly.
  * `include`: (optional) An array of either local or included shared configuration to be imported to the app config. To import local config, simply use the key. Included external config uses the format <config_name>.<config_block>.
  * `config`: (optional) An object containing k/v pairs defining application-specific configuration

Order of precedence for configuration application: Application-specific config > Locals > Imported

### Shared config

```
name: <string>
<string>:
  configThis test seems to be a flapper: I haven't reproduced locally.:
    <string>: <string|number|boolean>
```

* `name`: (required) Name to be used in root application configs when importing config blocks
* `<string>`: (required) An arbitrary string identifier for the config block to be used when importing. 
  * `config`: (required) Contains k/v pairs defining the configuration blocks.
See [dev-example.yml](example/dev-example.yml) for a concrete example.