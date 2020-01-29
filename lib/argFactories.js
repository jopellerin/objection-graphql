const _ = require('lodash');
const utils = require('./utils');
const graphqlRoot = require('graphql');

const {
  GraphQLInt,
  GraphQLList,
  GraphQLEnumType,
  GraphQLBoolean,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInputObjectType,
} = graphqlRoot;

module.exports = (argNameMap, opt) => [
  filter(argNameMap, opt),
  search(),
  orderBy(argNameMap.orderBy, 'asc', opt.typeCache),
  orderBy(argNameMap.orderByDesc, 'desc', opt.typeCache),
  range(argNameMap.range),
  limit(argNameMap.limit),
  offset(argNameMap.offset),
];

function filter(argNameMap, opt) {
  return (fields, modelClass) => {

    const operators = getOperators(argNameMap);
    const args = operators.reduce((args, operator) => ({
      ...args,
      ...operator(fields, modelClass),
    }), {});
    return {
      filter: {
        type: new GraphQLInputObjectType({
          name: `${utils.typeNameForModel(modelClass)}FilterInput`,
          fields: args,
        }),
        query: (builder, argValue) => {
          Object.keys(argValue).forEach((argName) => {
            return args[argName].query(builder, argValue[argName]);
          });
        },
      },
    };
  }
}

function getOperators(argNameMap) {
  return [
    basicOperator('=', ''),
    basicOperator('=', argNameMap.eq),
    basicOperator('>', argNameMap.gt),
    basicOperator('>=', argNameMap.gte),
    basicOperator('<', argNameMap.lt),
    basicOperator('<=', argNameMap.lte),
    basicOperator('like', argNameMap.like),
    isNull(argNameMap.isNull),
    whereIn('whereIn', argNameMap.in),
    whereIn('whereNotIn', argNameMap.notIn),
    likeNoCase(argNameMap.likeNoCase),
  ];
}

function basicOperator(op, postfix) {
  return (fields, modelClass) => reducePrimitiveFields(fields, modelClass, (args, field, propName, columnName) => {
    args[propName + postfix] = {
      type: field.type,

      query(query, value) {
        query.where(fullCol(columnName, modelClass), op, value);
      },
    };

    return args;
  });
}

function search() {
  return (fields, modelClass) => {
    if (!modelClass.searchProps) {
      return {};
    }

    return {
      search: {
        type: GraphQLString,
        query: (query, value) => {
          query.where(builder => {
            const props = modelClass.searchProps;
            props.forEach(prop => builder.orWhere(prop, 'like', `%${value}%`));
          });
        }
      },
    };
  };
}

function isNull(postfix) {
  return (fields, modelClass) => reducePrimitiveFields(fields, modelClass, (args, field, propName, columnName) => {
    args[propName + postfix] = {
      type: GraphQLBoolean,

      query(query, value) {
        if (value) {
          query.whereNull(fullCol(columnName, modelClass));
        } else {
          query.whereNotNull(fullCol(columnName, modelClass));
        }
      },
    };

    return args;
  });
}

function likeNoCase(postfix) {
  return (fields, modelClass) => reducePrimitiveFields(fields, modelClass, (args, field, propName, columnName) => {
    args[propName + postfix] = {
      type: field.type,

      query(query, value) {
        query.whereRaw('lower(??.??) like ?', [modelClass.tableName, columnName, value.toLowerCase()]);
      },
    };

    return args;
  });
}

function whereIn(method, postfix) {
  return (fields, modelClass) => reducePrimitiveFields(fields, modelClass, (args, field, propName, columnName) => {
    args[propName + postfix] = {
      type: new GraphQLList(field.type),

      query(query, value) {
        query[method](fullCol(columnName, modelClass), value);
      },
    };

    return args;
  });
}

function orderBy(argName, direction, typeCache) {
  return (fields, modelClass) => {
    const args = {};
    const modelClassTypeName = utils.typeNameForModel(modelClass);
    const typeName = `${modelClassTypeName}PropertiesEnum`;

    if (!typeCache[typeName]) {
      typeCache[typeName] = new GraphQLEnumType({
        name: typeName,
        values: reducePrimitiveFields(fields, modelClass, (values, field, propName) => {
          values[propName] = {
            value: propName,
            description: modelClass.jsonSchema.properties[propName].description || `No description for field ${propName}`,
          };
          return values;
        }),
      });
    }

    args[argName] = {
      type: typeCache[typeName],

      query(query, value) {
        // If variables are used, the value may already be parsed.
        if (!isFullCol(value)) {
          value = typeCache[typeName].parseValue(value);
        }

        query.orderBy(fullCol(modelClass.propertyNameToColumnName(value), modelClass), direction);
      },
    };

    return args;
  };
}

function range(argName) {
  return () => {
    const args = {};

    args[argName] = {
      type: new GraphQLList(GraphQLInt),

      query(query, values) {
        const start = parseInt(values[0]);
        const end = parseInt(values[1]);
        query.offset(start).limit((end - start) + 1);
      },
    };

    return args;
  };
}

function limit(argName) {
  return () => {
    const args = {};

    args[argName] = {
      type: new GraphQLList(GraphQLInt),

      query(query, value) {
        const number = parseInt(value);
        query.limit(number);
      },
    };

    return args;
  };
}

function offset(argName) {
  return () => {
    const args = {};

    args[argName] = {
      type: new GraphQLList(GraphQLInt),

      query(query, value) {
        const number = parseInt(value);
        query.offset(number);
      },
    };

    return args;
  };
}

function reducePrimitiveFields(fields, modelClass, func) {
  const propNames = Object.keys(fields);
  let output = {};

  for (let i = 0, l = propNames.length; i < l; i += 1) {
    const propName = propNames[i];
    const field = fields[propName];

    if (field.type instanceof GraphQLObjectType || field.type instanceof GraphQLList) {
      continue;
    }

    output = func(output, field, propName, modelClass.propertyNameToColumnName(propName));
  }

  return output;
}

function fullCol(columnName, modelClass) {
  return `${modelClass.tableName}.${columnName}`;
}

function isFullCol(value) {
  return value && value.indexOf('.') !== -1;
}
