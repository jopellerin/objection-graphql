var _ = require('lodash')
  , utils = require('./utils')
  , graphqlRoot = require('graphql')
  , GraphQLInt = graphqlRoot.GraphQLInt
  , GraphQLList = graphqlRoot.GraphQLList
  , GraphQLEnumType = graphqlRoot.GraphQLEnumType
  , GraphQLObjectType = graphqlRoot.GraphQLObjectType;

module.exports = function (argNameMap, opt) {
  return [
    basicOperator('=', ''),
    basicOperator('=', argNameMap["eq"]),
    basicOperator('>', argNameMap["gt"]),
    basicOperator('>=', argNameMap["gte"]),
    basicOperator('<', argNameMap["lt"]),
    basicOperator('<=', argNameMap["lte"]),
    basicOperator('like', argNameMap["like"]),
    whereIn('whereIn', argNameMap["in"]),
    whereIn('whereNotIn', argNameMap["notIn"]),
    likeNoCase(argNameMap["likeNoCase"]),
    orderBy(argNameMap["orderBy"], 'asc', opt.typeCache),
    orderBy(argNameMap["orderByDesc"], 'desc', opt.typeCache),
    range(argNameMap["range"])
  ];
};

function basicOperator(op, postfix) {
  return function (fields, modelClass) {
    return reducePrimitiveFields(fields, modelClass, function (args, field, propName, columnName) {
      args[propName + postfix] = {
        type: field.type,
        query: function (query, value) {
          query.where(columnName, op, value);
        }
      };

      return args;
    });
  };
}

function likeNoCase(postfix) {
  return function (fields, modelClass) {
    return reducePrimitiveFields(fields, modelClass, function (args, field, propName, columnName) {
      args[propName + postfix] = {
        type: field.type,
        query: function (query, value) {
          query.whereRaw('lower(??) like ?', [columnName, value.toLowerCase()]);
        }
      };

      return args;
    });
  };
}

function whereIn(method, postfix) {
  return function (fields, modelClass) {
    return reducePrimitiveFields(fields, modelClass, function (args, field, propName, columnName) {
      args[propName + postfix] = {
        type: new GraphQLList(field.type),
        query: function (query, value) {
          query[method](columnName, value);
        }
      };

      return args;
    });
  };
}

function orderBy(argName, direction, typeCache) {
  return function (fields, modelClass) {
    var args = {};

    var modelClassTypeName = utils.typeNameForModel(modelClass);
    var typeName = modelClassTypeName + 'PropertiesEnum';

    if (!typeCache[typeName]) {
      typeCache[typeName] = new GraphQLEnumType({
        name: typeName,
        values: reducePrimitiveFields(fields, modelClass, function (fields, field, propName, columnName) {
          fields[propName] = {value: columnName};
          return fields;
        })
      });
    }

    args[argName] = {
      type: typeCache[typeName],
      query: function (query, value) {
        query.orderBy(value, direction);
      }
    };

    return args;
  };
}

function range(argName) {
  return function () {
    var args = {};

    args[argName] = {
      type: new GraphQLList(GraphQLInt),
      query: function (query, values) {
        var start = parseInt(values[0]);
        var end = parseInt(values[1]);
        query.offset(start).limit(end - start + 1);
      }
    };

    return args;
  };
}

function reducePrimitiveFields(fields, modelClass, func) {
  return _.reduce(fields, function (output, field, propName) {
    if (field.type instanceof GraphQLObjectType || field.type instanceof GraphQLList) {
      return output;
    }

    var columnName = modelClass.propertyNameToColumnName(propName);
    return func(output, field, propName, columnName);
  }, {});
}