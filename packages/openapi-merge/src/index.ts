import { isPresent } from 'ts-is-present';
import { MergeInput, MergeResult, isErrorResult, PathModification, OperationSelection } from './data';
import { mergeTags } from './tags';
import { mergePathsAndComponents } from './paths-and-components';
import { mergeExtensions } from './extensions';
import { Swagger } from 'atlassian-openapi';
import { mergeInfos } from './info';

export { MergeInput, MergeResult, isErrorResult, PathModification, OperationSelection };

function getFirst<A>(inputs: Array<A>): A | undefined {
  if (inputs.length > 0) {
    return inputs[0];
  }

  return undefined;
}

function getFirstMatching<A, B>(inputs: Array<A>, extract: (input: A) => B | undefined): B | undefined {
  return getFirst(inputs.map(extract).filter(isPresent));
}

/**
 * Swagger Merge Tool
 */
export function merge(inputs: MergeInput): MergeResult {
  if (inputs.length === 0) {
    return { type: 'no-inputs', message: 'You must provide at least one OAS file as an input.' };
  }

  const pathAndComponentResult = mergePathsAndComponents(inputs);

  if (isErrorResult(pathAndComponentResult)) {
    return pathAndComponentResult;
  }

  const { paths, components: retComponents } = pathAndComponentResult;

  const components = Object.keys(retComponents).length === 0 ? undefined : retComponents;

  const output: Swagger.SwaggerV3 = mergeExtensions(
    {
      openapi: '3.0.3',
      info: mergeInfos(inputs),
      servers: getFirstMatching(inputs, input => input.oas.servers),
      externalDocs: getFirstMatching(inputs, input => input.oas.externalDocs),
      security: getFirstMatching(inputs, input => input.oas.security),
      tags: mergeTags(inputs),
      paths,
      components,
    },
    inputs.map(input => input.oas)
  );

  return { output };
}