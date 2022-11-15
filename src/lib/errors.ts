interface IAppError {app: string}

export class AppError extends Error implements IAppError {
  app: string

  constructor(app: string) {
    super();
    this.app = app;
  }
}

export class AppNotFoundError extends AppError {}
export class TeamsAppRequiredError extends AppError {}

interface IFileError {path: string}

export class FileError extends Error implements IFileError {
  path: string

  constructor(path: string) {
    super();
    this.path = path;
  }
}

export class InvalidConfigurationError extends FileError {}
export class FileDoesNotExistError extends FileError {}