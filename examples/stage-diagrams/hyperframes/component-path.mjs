import { isAbsolute, relative, resolve, sep } from 'node:path';

export function componentFilePath(directory, name) {
  const file = resolve(directory, name);
  const pathFromDirectory = relative(directory, file);
  if (!pathFromDirectory || pathFromDirectory === '..' || pathFromDirectory.startsWith(`..${sep}`) || isAbsolute(pathFromDirectory)) {
    throw Error(`File escapes component: ${name}`);
  }
  return file;
}
