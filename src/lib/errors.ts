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

export class RetryError extends Error {}