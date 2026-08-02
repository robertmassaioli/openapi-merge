import { ConfigurationInput, DescriptionMergeBehaviour, DescriptionTitle, Dispute, DisputePrefix, DisputeSuffix, ExtensionMergeNode, OperationSelection, PathModification, PathSelector } from './data';

export const DisputePrefixExamples: Array<DisputePrefix> = [
  {
    prefix: 'SomePrefix'
  },
  {
    prefix: 'SomePrefix',
    alwaysApply: true
  }
]

export const DisputeSuffixExamples: Array<DisputeSuffix> = [
  {
    suffix: 'Some suffix'
  },
  {
    suffix: 'Some suffix',
    alwaysApply: true
  }
];

export const DisputeExamples: Array<Dispute> = [
  ...DisputePrefixExamples,
  ...DisputeSuffixExamples,
];

export const DescriptionTitleExamples: Array<DescriptionTitle> = [
  {
    value: 'Title 1'
  },
  {
    value: 'Title Level 2',
    headingLevel: 2
  },
  {
    value: 'Inperceptible title',
    headingLevel: 6
  }
];

const DescriptionMergeBehavioursWithTitles = DescriptionTitleExamples.map(title => ({
  append: true,
  title
}));

export const DescriptionMergeBehaviourExamples: Array<DescriptionMergeBehaviour> = [
  {
    append: true
  },
  ...DescriptionMergeBehavioursWithTitles
];

export const PathSelectorExamples: Array<PathSelector> = [
  {
    path: '/admin/*'
  },
  {
    path: '/admin/users',
    method: 'get'
  },
  {
    path: '/cache',
    method: ['get', 'PURGE']
  }
];

export const PathSelectorListExamples: Array<Array<PathSelector>> = [
  [PathSelectorExamples[0]],
  PathSelectorExamples
];

export const OperationSelectionExamples: Array<OperationSelection> = [
  {
    includeTags: ['include-this-tag-only']
  },
  {
    excludeTags: ['exclude-these-tags']
  },
  {
    includeTags: ['select-this-first'],
    excludeTags: ['filter-out-with-this-tag']
  },
  {
    includePaths: [{ path: '/admin/*' }]
  },
  {
    excludePaths: [{ path: '/admin/users', method: 'get' }]
  }
];

export const PathModificationExamples: Array<PathModification> = [
  {
    stripStart: 'Model'
  },
  {
    prepend: 'Model'
  },
  {
    stripStart: 'Jira',
    prepend: 'Object'
  }
];

export const ConfigurationInputExamples: Array<Array<ConfigurationInput>> = [
  [
    {
      inputFile: './swagger.json'
    },
    {
      inputURL: 'https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json'
    }
  ],
  [
    {
      inputFile: './swagger.json'
    },
    {
      inputURL: 'https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json'
    },
    {
      inputFile: './swagger.json',
      description: {
        append: true,
        title: {
          value: 'My Swagger Description',
          headingLevel: 1
        }
      },
      dispute: {
        suffix: 'Model',
        alwaysApply: true
      },
      operationSelection: {
        includeTags: ['public'],
        excludeTags: ['private']
      },
      pathModification: {
        stripStart: '/rest',
        prepend: '/jira'
      }
    }
  ]
];
/** Per-input tag injection (issue #112). */
export const TagInjectionExamples: Array<{ name: string; description?: string }> = [
  { name: 'billing' },
  { name: 'billing', description: 'Everything served by the billing service.' },
];

/** `x-tagGroups` (issue #60) re-derived as a strategy tree -- see proposal 47. */
const XTagGroupsMergeStrategy: ExtensionMergeNode = {
  kind: 'array',
  strategy: 'union-by-key',
  key: 'name',
  item: {
    kind: 'object',
    strategy: 'merge',
    fields: {
      tags: { kind: 'array', strategy: 'concat-unique' },
    },
  },
};

export const ExtensionMergeStrategiesExamples: Array<{ [extensionKey: string]: ExtensionMergeNode }> = [
  { 'x-tagGroups': XTagGroupsMergeStrategy },
  {
    'x-owner': { kind: 'scalar', strategy: 'error' },
  },
  {
    'x-tagGroups': XTagGroupsMergeStrategy,
    'x-rate-limit-overrides': { kind: 'object', strategy: 'merge' },
  },
];
