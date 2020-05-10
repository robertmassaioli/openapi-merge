import { isPresent } from 'ts-is-present';
import { MergeInput, MergeResult, isErrorResult } from './data';
import { mergeTags } from './tags';
import { mergePathsAndComponents } from './paths-and-components';

/**
 * Swagger Merge Tool
 */

export function merge(inputs: MergeInput): MergeResult {
  if (inputs.length === 0) {
    return { type: 'no-inputs', message: 'You must provide at least one OAS file as an input.' };
  }

  const rootInput = inputs[0];

  const pathAndComponentResult = mergePathsAndComponents(inputs);

  if (isErrorResult(pathAndComponentResult)) {
    return pathAndComponentResult;
  }

  const { paths, components } = pathAndComponentResult;

  return {
    output: {
      openapi: '3.0.2',
      info: rootInput.oas.info,
      servers: getFirstMatching(inputs, input => input.oas.servers),
      externalDocs: getFirstMatching(inputs, input => input.oas.externalDocs),
      // TODO implement security merging
      security: [],
      tags: mergeTags(inputs),
      paths,
      components,
    }
  };
}

function getFirstMatching<A, B>(inputs: Array<A>, extract: (input: A) => B | undefined): B | undefined {
  return getFirst(inputs.map(extract).filter(isPresent));
}


function getFirst<A>(inputs: Array<A>): A | undefined {
  if (inputs.length > 0) {
    return inputs[0];
  }

  return undefined;
}