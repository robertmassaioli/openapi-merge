import { Swagger } from '@atlassian/atlassian-openapi';
import { MergeInput, SingleMergeInput } from './data';
import { isPresent } from 'ts-is-present';
import _ from 'lodash';

function getInfoDescriptionWithHeading(mergeInput: SingleMergeInput): string | undefined {
  const { description } = mergeInput.oas.info;

  if (description === undefined) {
    return undefined;
  }

  const trimmedDescription = description.trimRight();

  if (mergeInput.description === undefined || mergeInput.description.title === undefined) {
    return trimmedDescription;
  }

  const { title } = mergeInput.description;

  const headingLevel = title.headingLevel || 1;

  return `${'#'.repeat(headingLevel)} ${title.value}\n\n${trimmedDescription}`;
}

export function mergeInfos(mergeInput: MergeInput, override?: Partial<Swagger.Info>): Swagger.Info {
  const finalInfo = _.cloneDeep(mergeInput[0].oas.info);

  const appendedDescriptions = mergeInput
    .filter(i => i.description && i.description.append)
    .map(getInfoDescriptionWithHeading)
    .filter(isPresent);

  if (appendedDescriptions.length > 0) {
    finalInfo.description = appendedDescriptions.join('\n\n');
  }

  // Applied last, so it wins over both first-input-wins and the appended
  // descriptions (issue #102). An aggregate of several services is not any one
  // of them, and its title should say so rather than name whichever input
  // happened to be listed first.
  //
  // Merged field by field rather than replacing `info` wholesale: someone
  // overriding only the title should not have to restate `version`, which is
  // required. Only keys actually present override -- an explicit `undefined`
  // does not blank out an input's value, because a config file cannot express
  // the difference between "absent" and "explicitly undefined" and the
  // surprising reading is the destructive one.
  if (override !== undefined) {
    for (const key of Object.keys(override) as Array<keyof Swagger.Info>) {
      const value = override[key];
      if (value !== undefined) {
        (finalInfo as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  return finalInfo;
}