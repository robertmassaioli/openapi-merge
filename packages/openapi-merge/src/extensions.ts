import { OpenApiDocument } from './oas31';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Extensions = { [extensionKey: string]: any };

function extractExtensions(input: OpenApiDocument): Extensions {
  const result: Extensions = {};

  const plainObject: Extensions = input;

  for (const key in plainObject) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (key.startsWith('x-') && plainObject.hasOwnProperty(key)) {
      result[key] = plainObject[key];
    }
  }

  return result;
}

function mergeExtensionsHelper(extensions: Extensions[]): Extensions {
  if (extensions.length === 0) {
    return {};
  }

  if (extensions.length === 1) {
    return extensions[0];
  }

  const result = { ...extensions[0] };

  for (let extensionIndex = 1; extensionIndex < extensions.length; extensionIndex++) {
    const ext = extensions[extensionIndex];

    for (const extensionKey in ext) {
      /* eslint-disable-next-line no-prototype-builtins */
      if (result[extensionKey] === undefined && ext.hasOwnProperty(extensionKey)) {
        result[extensionKey] = ext[extensionKey];
      }
    }
  }

  return result;
}

export function mergeExtensions(mergeTarget: OpenApiDocument, oass: OpenApiDocument[]): OpenApiDocument {
  return {
    ...mergeTarget,
    ...mergeExtensionsHelper([extractExtensions(mergeTarget), ...oass.map(extractExtensions)])
  };
}