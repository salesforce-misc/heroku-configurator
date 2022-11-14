export class AppNotFoundError extends Error {
  app: string

  constructor(app: string) {
    super();
    this.app = app;
  }
}

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