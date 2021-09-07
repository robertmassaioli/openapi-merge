import { ConfigurationInput, DescriptionMergeBehaviour, DescriptionTitle, Dispute, DisputePrefix, DisputeSuffix, OperationSelection, PathModification } from './data';

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