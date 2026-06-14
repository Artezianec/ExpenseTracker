export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface DbErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  userId?: string;
}

export function handleDbError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  userId?: string,
): never {
  const errInfo: DbErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    userId,
  };
  console.error('ApexStream DB Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
