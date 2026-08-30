"use strict";

const zod = require("zod");

function buildStructuredResponseJsonSchema(input, useMinimizedSchema = false) {
  if (useMinimizedSchema) {
    return buildGeminiCompatibleSchema(input);
  }
  const actionVariants = input.availableActions.map((action) => {
    const properties = {
      actionId: { const: action.signature },
      args: buildArgsObjectSchema(action.args)
    };
    const required = ["actionId", "args"];
    if (action.requiresTarget) {
      if (action.validTargetCharacterIds && action.validTargetCharacterIds.length > 0) {
        properties.targetCharacterId = {
          type: "integer",
          enum: action.validTargetCharacterIds
        };
      } else {
        properties.targetCharacterId = {
          type: "integer"
        };
      }
      required.push("targetCharacterId");
    } else {
      if (action.validTargetCharacterIds && action.validTargetCharacterIds.length > 0) {
        properties.targetCharacterId = {
          anyOf: [
            { type: "integer", enum: action.validTargetCharacterIds },
            { type: "null" }
          ]
        };
      } else {
        properties.targetCharacterId = {
          anyOf: [{ type: "integer" }, { type: "null" }]
        };
      }
    }
    return {
      type: "object",
      additionalProperties: false,
      properties,
      required
    };
  });
  const schema2 = {
    type: "object",
    additionalProperties: false,
    properties: {
      actions: {
        type: "array",
        items: {
          anyOf: actionVariants
        },
        default: []
      }
    },
    required: ["actions"]
  };
  return schema2;
}
function buildGeminiCompatibleSchema(input) {
  const allTargetIds = /* @__PURE__ */ new Set();
  for (const action of input.availableActions) {
    if (action.validTargetCharacterIds) {
      action.validTargetCharacterIds.forEach((id) => allTargetIds.add(id));
    }
  }
  const argMetadata = {};
  for (const action of input.availableActions) {
    for (const arg of action.args) {
      const name = arg.name;
      if (!argMetadata[name]) {
        argMetadata[name] = {
          type: arg.type,
          constraints: {},
          usedByActions: /* @__PURE__ */ new Set(),
          requiredByActions: /* @__PURE__ */ new Set()
        };
      }
      argMetadata[name].usedByActions.add(action.signature);
      if (arg.required) {
        argMetadata[name].requiredByActions.add(action.signature);
      }
      switch (arg.type) {
        case "number": {
          break;
        }
        case "string": {
          const meta = argMetadata[name];
          if (arg.minLength !== void 0) {
            meta.constraints.minLength = meta.constraints.minLength !== void 0 ? Math.max(meta.constraints.minLength, arg.minLength) : arg.minLength;
          }
          if (arg.maxLength !== void 0) {
            meta.constraints.maxLength = meta.constraints.maxLength !== void 0 ? Math.min(meta.constraints.maxLength, arg.maxLength) : arg.maxLength;
          }
          if (arg.pattern) {
            const patternStr = typeof arg.pattern === "string" ? arg.pattern : arg.pattern.source;
            if (!meta.constraints.pattern) {
              meta.constraints.pattern = patternStr;
            }
          }
          break;
        }
        case "enum": {
          const meta = argMetadata[name];
          if (!meta.enumValues) {
            meta.enumValues = /* @__PURE__ */ new Set();
          }
          arg.options.forEach((opt) => meta.enumValues.add(opt));
          break;
        }
      }
    }
  }
  const allArgProperties = {};
  for (const [name, meta] of Object.entries(argMetadata)) {
    let argSchema;
    switch (meta.type) {
      case "number": {
        argSchema = { type: "number", ...meta.constraints };
        break;
      }
      case "string": {
        argSchema = { type: "string", ...meta.constraints };
        break;
      }
      case "enum": {
        argSchema = {
          type: "string",
          enum: Array.from(meta.enumValues || [])
        };
        break;
      }
      case "boolean": {
        argSchema = { type: "boolean" };
        break;
      }
      default: {
        argSchema = { not: {} };
      }
    }
    const actionsList = Array.from(meta.usedByActions).sort();
    const requiredList = Array.from(meta.requiredByActions).sort();
    let description = `Used by: ${actionsList.join(", ")}`;
    if (requiredList.length > 0) {
      description += `. Required for: ${requiredList.join(", ")}`;
    }
    argSchema.description = description;
    allArgProperties[name] = argSchema;
  }
  const actionIdVariants = input.availableActions.map((action) => {
    const variant = {
      const: action.signature,
      description: action.description || action.signature
    };
    if (action.validTargetCharacterIds && action.validTargetCharacterIds.length > 0) {
      variant.validTargetCharacterIds = action.validTargetCharacterIds;
    }
    if (action.args && action.args.length > 0) {
      variant.availableArgs = action.args.map((arg) => ({
        name: arg.name,
        type: arg.type,
        required: arg.required || false
      }));
    }
    return variant;
  });
  const itemProperties = {
    actionId: {
      anyOf: actionIdVariants,
      description: "The action to perform"
    },
    args: {
      type: "object",
      properties: allArgProperties,
      description: "Arguments for the action. Different actions require different arguments."
    }
  };
  if (allTargetIds.size > 0) {
    itemProperties.targetCharacterId = {
      type: "integer",
      enum: Array.from(allTargetIds),
      description: "The character ID to target with this action"
    };
  }
  const schema2 = {
    type: "object",
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: itemProperties,
          description: "An action to perform in the game"
        },
        description: "List of actions to perform"
      }
    },
    required: ["actions"]
  };
  return schema2;
}
function buildArgsObjectSchema(args) {
  const properties = {};
  const required = [];
  for (const arg of args) {
    const name = arg.name;
    switch (arg.type) {
      case "number": {
        const num = { type: "number" };
        properties[name] = num;
        if (arg.required) required.push(name);
        break;
      }
      case "string": {
        const str = { type: "string" };
        if (arg.minLength !== void 0) {
          str.minLength = arg.minLength;
        }
        if (arg.maxLength !== void 0) {
          str.maxLength = arg.maxLength;
        }
        if (arg.pattern) {
          str.pattern = typeof arg.pattern === "string" ? arg.pattern : arg.pattern.source;
        }
        properties[name] = str;
        if (arg.required) required.push(name);
        break;
      }
      case "enum": {
        const en = { type: "string", enum: arg.options };
        properties[name] = en;
        if (arg.required) required.push(name);
        break;
      }
      case "boolean": {
        const bool = { type: "boolean" };
        properties[name] = bool;
        if (arg.required) required.push(name);
        break;
      }
      default: {
        properties[name] = { not: {} };
        break;
      }
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}
function buildNumberSchema(arg) {
  let schema2 = zod.z.number({ required_error: `${arg.name} must be provided` });
  if (arg.min !== void 0) {
    schema2 = schema2.min(arg.min, `${arg.name} must be >= ${arg.min}`);
  }
  if (arg.max !== void 0) {
    schema2 = schema2.max(arg.max, `${arg.name} must be <= ${arg.max}`);
  }
  if (arg.step !== void 0 && arg.step !== 0) {
    const { step } = arg;
    const base = arg.min ?? 0;
    schema2 = schema2.refine(
      (value) => Number.isInteger((value - base) / step),
      `${arg.name} must increment by ${step}`
    );
  }
  if (!arg.required) {
    return schema2.optional().nullable();
  }
  return schema2;
}
function buildStringSchema(arg) {
  let schema2 = zod.z.string({ required_error: `${arg.name} must be provided` });
  if (arg.minLength !== void 0) {
    schema2 = schema2.min(arg.minLength, `${arg.name} too short`);
  }
  if (arg.maxLength !== void 0) {
    schema2 = schema2.max(arg.maxLength, `${arg.name} too long`);
  }
  if (arg.pattern) {
    const regex = typeof arg.pattern === "string" ? new RegExp(arg.pattern) : arg.pattern;
    schema2 = schema2.regex(regex, `${arg.name} has invalid format`);
  }
  if (!arg.required) {
    return schema2.optional().nullable();
  }
  return schema2;
}
function buildEnumSchema(arg) {
  const options = arg.options;
  if (!options.length) {
    return zod.z.never({
      invalid_type_error: `${arg.name} has no enum options`
    });
  }
  const enumOpts = options;
  let schema2 = zod.z.enum(enumOpts, {
    required_error: `${arg.name} must be provided`
  });
  if (!arg.required) {
    return schema2.optional().nullable();
  }
  return schema2;
}
function buildBooleanSchema(arg) {
  let schema2 = zod.z.boolean({ required_error: `${arg.name} must be provided` });
  if (!arg.required) {
    return schema2.optional().nullable();
  }
  return schema2;
}
function buildArgumentSchema(arg) {
  switch (arg.type) {
    case "number":
      return buildNumberSchema(arg);
    case "string":
      return buildStringSchema(arg);
    case "enum":
      return buildEnumSchema(arg);
    case "boolean":
      return buildBooleanSchema(arg);
    default: {
      const exhaustiveCheck = arg;
      return zod.z.never({
        invalid_type_error: `Argument '${exhaustiveCheck.name ?? "unknown"}' has unsupported type`
      });
    }
  }
}
function buildActionInvocationSchema(input) {
  const variants = input.availableActions.map((action) => {
    const targetSchema = (() => {
      if (action.validTargetCharacterIds && action.validTargetCharacterIds.length > 0) {
        return zod.z.number().int().refine(
          (id) => action.validTargetCharacterIds.includes(id),
          `targetCharacterId must be one of ${action.validTargetCharacterIds.join(", ")}`
        );
      }
      if (action.requiresTarget) {
        return zod.z.number().int({ message: "targetCharacterId must be provided for this action" });
      }
      return zod.z.number().int().optional().nullable();
    })();
    const argsShape = {};
    for (const arg of action.args) {
      argsShape[arg.name] = buildArgumentSchema(arg);
    }
    const argsObjectSchema = Object.keys(argsShape).length === 0 ? zod.z.object({}).strict() : zod.z.object(argsShape).strict();
    const variant = zod.z.object({
      actionId: zod.z.literal(action.signature),
      targetCharacterId: targetSchema,
      args: argsObjectSchema.optional().default({})
    }).strict();
    return variant;
  });
  if (variants.length === 0) {
    return zod.z.never();
  }
  return zod.z.discriminatedUnion("actionId", variants);
}
function buildStructuredResponseSchema(input) {
  const invocationSchema = buildActionInvocationSchema(input);
  const schema2 = zod.z.object({
    actions: zod.z.array(invocationSchema).default([])
  }).strict();
  return schema2;
}

module.exports = { buildStructuredResponseJsonSchema, buildStructuredResponseSchema, buildGeminiCompatibleSchema, buildActionInvocationSchema };


