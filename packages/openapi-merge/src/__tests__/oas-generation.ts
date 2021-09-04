import { Swagger } from 'atlassian-openapi';

export function toOAS(paths: Swagger.Paths, components?: Swagger.Components): Swagger.SwaggerV3 {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Generated Swagger Template',
      version: '1.2.3'
    },
    paths,
    components
  }
}