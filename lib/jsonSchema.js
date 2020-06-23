const _ = require('lodash');
const {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
} = require('graphql');
const {
  GraphQLDate,
  GraphQLTime,
  GraphQLDateTime,
} = require('graphql-iso-date');
const utils = require('./utils');

const jsonSchemaToGraphQLFields = (jsonSchema, opt = {}) => {
  const ctx = _.defaults(opt, {
    include: null,
    exclude: null,
    typeNamePrefix: '',
    typeCache: {},
    customTypes: {},
  });

  const fields = {};

  _.forOwn(jsonSchema.properties, (propSchema, propName) => {
    if (utils.isExcluded(ctx, propName)) {
      return;
    }

    fields[propName] = toGraphQlField(propSchema, propName, ctx);
  });

  return fields;
}

const jsonSchemaToGraphQLInput = (jsonSchema, opt = {}) => {
  const ctx = _.defaults(opt, {
    include: null,
    exclude: null,
    typeNamePrefix: '',
    typeCache: {},
    customTypes: {},
  });

  const { properties } = jsonSchema;
  return Object.keys(properties).reduce((fields, propName) => {
    if (utils.isExcluded(ctx, propName)) {
      return fields;
    }
    const propSchema = properties[propName];
    const field = toGraphQLInputField(propSchema, propName, ctx);
    return {
      ...fields,
      [propName]: field,
    };
  }, {});
};

const toGraphQlField = (propSchema, propName, ctx) => {
  let schemas;

  if (propSchema.anyOf || propSchema.oneOf) {
    schemas = _.reject(propSchema.anyOf || propSchema.oneOf, utils.isNullSchema);

    if (schemas.length === 1) {
      return toGraphQlField(schemas[0], propName, ctx);
    }
    throw new Error(`multiple anyOf/oneOf schemas in json schema is not supported. schema: ${JSON.stringify(propSchema)}`);
  } else if (_.isArray(propSchema.type)) {
    const type = _.reject(propSchema.type, utils.isNullType);

    if (type.length === 1) {
      return typeToGraphQLField(type[0], propSchema, propName, ctx);
    }
    throw new Error(`multiple values in json schema \`type\` property not supported. schema: ${JSON.stringify(propSchema)}`);
  } else {
    return typeToGraphQLField(propSchema.type, propSchema, propName, ctx);
  }
};

const toGraphQLInputField = (propSchema, propName, ctx) => {
  let schemas;

  if (propSchema.anyOf || propSchema.oneOf) {
    schemas = _.reject(propSchema.anyOf || propSchema.oneOf, utils.isNullSchema);

    if (schemas.length === 1) {
      return toGraphQLInputField(schemas[0], propName, ctx);
    }
    throw new Error(`multiple anyOf/oneOf schemas in json schema is not supported. schema: ${JSON.stringify(propSchema)}`);
  } else if (_.isArray(propSchema.type)) {
    const type = _.reject(propSchema.type, utils.isNullType);

    if (type.length === 1) {
      return typeToGraphQLInputField(type[0], propSchema, propName, ctx);
    }
    throw new Error(`multiple values in json schema \`type\` property not supported. schema: ${JSON.stringify(propSchema)}`);
  } else {
    return typeToGraphQLInputField(propSchema.type, propSchema, propName, ctx);
  }
};

const typeToGraphQLInputField = (type, jsonSchema, propName, ctx) => {
  let graphQlField;

  if (utils.hasCustomType(type, ctx)) {
    graphQlField = customTypeToGraphQlField(type, jsonSchema, propName, ctx);
  } else if (_.isArray(jsonSchema.enum)) {
    graphQlField = enumToGraphQLField(jsonSchema.enum, propName, ctx);
  } else if (type === 'object') {
    graphQlField = objectToGraphQLInputField(jsonSchema, propName, ctx);
  } else if (type === 'array') {
    graphQlField = arrayToGraphQLInputField(jsonSchema, propName, ctx);
  } else {
    graphQlField = primitiveToGraphQLField(type);
  }

  if (jsonSchema.description) {
    graphQlField.description = jsonSchema.description;
  }

  return graphQlField;
};

const typeToGraphQLField = (type, jsonSchema, propName, ctx) => {
  let graphQlField;

  if (utils.hasCustomType(type, ctx)) {
    graphQlField = customTypeToGraphQlField(type, jsonSchema, propName, ctx);
  } else if (_.isArray(jsonSchema.enum)) {
    graphQlField = enumToGraphQLField(jsonSchema.enum, propName, ctx);
  } else if (type === 'object') {
    graphQlField = objectToGraphQLField(jsonSchema, propName, ctx);
  } else if (type === 'array') {
    graphQlField = arrayToGraphQLField(jsonSchema, propName, ctx);
  } else {
    graphQlField = primitiveToGraphQLField(type);
  }

  if (jsonSchema.description) {
    graphQlField.description = jsonSchema.description;
  }

  return graphQlField;
}

const customTypeToGraphQlField = (type, jsonSchema, propName, ctx) => {
  return { type: ctx.customTypes[type] };
}

const enumToGraphQLField = (enumeration, propName, ctx) => {
  ctx.typeIndex += 1;
  const typeName = `${ctx.typeNamePrefix + _.upperFirst(_.camelCase(propName))}Enum`;

  if (!ctx.typeCache[typeName]) {
    ctx.typeCache[typeName] = new GraphQLEnumType({
      name: typeName,
      values: _.reduce(enumeration, (values, enumValue) => {
        values[enumValue] = { value: enumValue };
        return values;
      }, {}),
    });
  }

  return { type: ctx.typeCache[typeName] };
}

const objectToGraphQLField = (jsonSchema, propName, ctx) => {
  ctx.typeIndex += 1;
  const typeName = `${ctx.typeNamePrefix + _.upperFirst(_.camelCase(propName))}JsonType`;

  if (!ctx.typeCache[typeName]) {
    ctx.typeCache[typeName] = new GraphQLObjectType({
      name: typeName,
      fields() {
        const fields = {};

        _.forOwn(jsonSchema.properties, (propSchema, curPropName) => {
          fields[curPropName] = toGraphQlField(propSchema, curPropName, ctx);
        });

        return fields;
      },
    });
  }

  return { type: ctx.typeCache[typeName] };
}

const objectToGraphQLInputField = (jsonSchema, propName, ctx) => {
  ctx.typeIndex += 1;
  const typeName = `${ctx.typeNamePrefix + _.upperFirst(_.camelCase(propName))}JsonInputType`;

  if (!ctx.typeCache[typeName]) {
    ctx.typeCache[typeName] = new GraphQLInputObjectType({
      name: typeName,
      fields() {
        const fields = {};

        _.forOwn(jsonSchema.properties, (propSchema, curPropName) => {
          fields[curPropName] = toGraphQLInputField(propSchema, curPropName, ctx);
        });

        return fields;
      },
    });
  }

  return { type: ctx.typeCache[typeName] };
}

const arrayToGraphQLField = (jsonSchema, propName, ctx) => {
  if (_.isArray(jsonSchema.items)) {
    throw new Error(`multiple values in \`items\` of array type is not supported. schema: ${JSON.stringify(jsonSchema)}`);
  }
  const field = typeToGraphQLField(jsonSchema.items.type, jsonSchema.items, `${propName}Item`, ctx);
  return {
    name: propName,
    type: new GraphQLList(field.type),
  };
}

const arrayToGraphQLInputField = (jsonSchema, propName, ctx) => {
  if (_.isArray(jsonSchema.items)) {
    throw new Error(`multiple values in \`items\` of array type is not supported. schema: ${JSON.stringify(jsonSchema)}`);
  }
  const field = typeToGraphQLInputField(jsonSchema.items.type, jsonSchema.items, `${propName}Item`, ctx);
  return {
    name: propName,
    type: new GraphQLList(field.type),
  };
}

const primitiveToGraphQLField = (type) => {
  const graphQlType = primitiveToGraphQLType(type);

  if (!graphQlType) {
    throw new Error(`cannot convert json schema type "${type}" into GraphQL type`);
  }

  return { type: graphQlType };
}

const primitiveToGraphQLType = (type) => {
  switch (type) {
    case 'string': return GraphQLString;
    case 'integer': return GraphQLInt;
    case 'number': return GraphQLFloat;
    case 'boolean': return GraphQLBoolean;
    case 'date': return GraphQLDate;
    case 'dateTime': return GraphQLDateTime;
    case 'time': return GraphQLTime;
    default: return null;
  }
}

module.exports = {
  jsonSchemaToGraphQLFields,
  jsonSchemaToGraphQLInput,
  objectToGraphQLField,
};
