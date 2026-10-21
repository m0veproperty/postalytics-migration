export class WorkspaceError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ConditionalWriteConflict extends Error {
  constructor() {
    super('The shared document changed during this write.');
    this.name = 'ConditionalWriteConflict';
  }
}
