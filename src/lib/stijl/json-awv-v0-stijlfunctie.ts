import { array } from "fp-ts/lib/Array";
import { Function1, Function2, pipe } from "fp-ts/lib/function";
import * as option from "fp-ts/lib/Option";
import { none, Option, some } from "fp-ts/lib/Option";
import * as ol from "openlayers";

import { composeValidators2, validationChain as chain, Validator } from "../util/validation";

import { Awv0StaticStyleInterpreters, StaticStyleEncoders } from "./json-awv-v0-stijl";
import * as oi from "./json-object-interpreting";
import { fail, Interpreter, ok, Validation } from "./json-object-interpreting";
import {
  Awv0DynamicStyle,
  Between,
  Combination,
  Comparison,
  ComparisonOperator,
  EnvironmentExtraction,
  Exists,
  Expression,
  Literal,
  Negation,
  PropertyExtraction,
  Rule,
  RuleConfig,
  TypeType,
  ValueType
} from "./stijl-function-types";

////////////////
// Private types
//

// Handige alias om de volgende definities wat beknopter te houden
type olStyle = ol.style.Style;

// Net zoals een RuleConfig, maar het verschil is dat de individuele rules al een OL style hebben ipv een een definitie.
interface RuleStyleConfig {
  readonly rules: RuleStyle[];
}

// Net zoals een Rule, maar met een gegenereerde OL style ipv een definitie.
interface RuleStyle {
  readonly condition: Expression;
  readonly style: olStyle;
}

const RuleStyleConfig: Function1<RuleStyle[], RuleStyleConfig> = rules => ({ rules: rules });
const alwaysTrue: Expression = { kind: "Literal", value: true };
const RuleStyle: Function2<Option<Expression>, olStyle, RuleStyle> = (maybeCondition, style) => ({
  condition: maybeCondition.getOrElse(alwaysTrue),
  style: style
});

//////////////////////////////////////////////
// Valideer de regels en controleer de stijlen
//

export const jsonAwvV0RuleInterpreter: Interpreter<Awv0DynamicStyle> = (json: Object) => {
  const typeType: Interpreter<TypeType> = (o: string) =>
    o === "boolean" || o === "string" || o === "number" ? ok(o as TypeType) : fail(`Het type moet 'boolean' of 'string' of 'number' zijn`);
  const literal: Interpreter<Expression> = oi.map(Literal, oi.field("value", oi.firstOf<ValueType>(oi.bool, oi.num, oi.str)));
  const environment: Interpreter<Expression> = oi.map2(EnvironmentExtraction, oi.field("type", typeType), oi.field("ref", oi.str));
  const property: Interpreter<Expression> = oi.map2(PropertyExtraction, oi.field("type", typeType), oi.field("ref", oi.str));
  const propertyExists: Interpreter<Expression> = oi.map(Exists("PropertyExists"), oi.field("ref", oi.str));
  const environmentExists: Interpreter<Expression> = oi.map(Exists("EnvironmentExists"), oi.field("ref", oi.str));
  const comparison: (kind: ComparisonOperator) => Interpreter<Expression> = (kind: ComparisonOperator) =>
    oi.map2(Comparison(kind), oi.field("left", o => expression(o)), oi.field("right", o => expression(o)));
  const combination = (kind: "&&" | "||") =>
    oi.map2(Combination(kind), oi.field("left", o => expression(o)), oi.field("right", o => expression(o)));
  const negation = oi.map(Negation, oi.field("expression", o => expression(o)));
  const between = oi.map3(
    Between,
    oi.field("value", o => expression(o)),
    oi.field("lower", o => expression(o)),
    oi.field("upper", o => expression(o))
  );
  const expression = oi.byTypeDiscriminator("kind", {
    Literal: literal,
    Property: property,
    Environment: environment,
    PropertyExists: propertyExists,
    EnvironmentExists: environmentExists,
    "<": comparison("<"),
    "<=": comparison("<="),
    ">": comparison(">"),
    ">=": comparison(">="),
    "==": comparison("=="),
    "!=": comparison("!="),
    "L==": comparison("L=="),
    "&&": combination("&&"),
    "||": combination("||"),
    "!": negation,
    "<=>": between
  });

  const rule: Interpreter<Rule> = oi.map2(
    Rule,
    oi.map(maybeCondition => maybeCondition.getOrElse(alwaysTrue), oi.optField("condition", expression)),
    oi.field("style", oi.field("definition", Awv0StaticStyleInterpreters.jsonAwvV0Definition))
  );

  const ruleConfig: Interpreter<RuleConfig> = oi.map(RuleConfig, oi.arr(rule));

  return oi
    .field("rules", ruleConfig)(json)
    .mapFailure(msg => [`syntaxcontrole: ${msg}`]);
};

const jsonAwvV0RuleConfig: Function1<Awv0DynamicStyle, RuleStyleConfig> = style => ({
  rules: style.rules.map(rule => ({
    condition: rule.condition,
    style: StaticStyleEncoders.awvV0Style.encode(rule.style.definition)
  }))
});

export const jsonAwvV0RuleCompiler: Validator<Awv0DynamicStyle, ol.StyleFunction> = pipe(
  jsonAwvV0RuleConfig,
  compileRules
);

/////////////////////////////////////////////////////////////////
// Typechecking en compilatie van de regels tot een StyleFunction
//

function compileRules(ruleCfg: RuleStyleConfig): Validation<ol.StyleFunction> {
  // Een abstractie van het tuple (feature, resolution). Laat toe om de functies hierna wat compacter te schrijven, minder gegevens op de
  // stack te moeten zetten en eventueel eenvoudig andere "environment"-variabelen toe te voegen.
  interface Context {
    feature: ol.Feature;
    resolution: number;
  }

  // Evaluator is een functie die at runtime aangeroepen wordt en de context omzet in misschien een waarde.
  // De Option is nodig omdat properties in een feature niet noodzakelijk aanwezig zijn (met het correcte type).
  type Evaluator = (ctx: Context) => Option<ValueType>;

  // Tijdens de compilatiefase hebben we het resultaattype van de toekomstige evaluatie nodig zodat we kunnen garanderen dat we enkel
  // operaties samenstellen die type-compatibel zijn.
  interface TypedEvaluator {
    evaluator: Evaluator;
    typeName: TypeType;
  }

  // Om de foutboodschappen tijdens het compileren door te geven wordt alles ingepakt in een Validation.
  type ValidatedTypedEvaluator = Validation<TypedEvaluator>;

  // Een constructor voor een TypedEvaluator.
  const TypedEvaluator = <V extends ValueType>(evaluator: Evaluator, typeName: TypeType) =>
    ({ evaluator: evaluator, typeName: typeName } as TypedEvaluator);

  // Run-time helpers
  const isDefined = value => value !== undefined && value !== null;
  const getNestedProperty = (propertyKey: string, object: Object) => {
    return isDefined(propertyKey)
      ? propertyKey.split(".").reduce((obj, key) => (isDefined(obj) && isDefined(obj[key]) ? obj[key] : null), object)
      : null;
  };
  const getProperty = (key: string, typeName: TypeType) => (ctx: Context): Option<any> =>
    option
      .fromNullable(ctx.feature.get("properties"))
      .chain(properties => option.fromNullable(getNestedProperty(key, properties)))
      .filter(value => typeof value === typeName);
  const checkFeatureDefined = (key: string) => (ctx: Context) =>
    option.fromNullable(ctx.feature.get("properties")).map(properties => properties.hasOwnProperty(key));
  const getResolution = (ctx: Context) => some(ctx.resolution);

  // Type check functies
  const typeIs = (targetType: TypeType) => (t1: TypeType) =>
    t1 === targetType ? ok({}) : fail(`typecontrole: '${t1}' gevonden, maar '${targetType}' verwacht`);
  const allTypes2 = (targetType: TypeType) => (t1: TypeType, t2: TypeType) =>
    t1 === targetType && t2 === targetType
      ? ok({})
      : fail(`typecontrole: '${t1}' en '${t2}' gevonden, maar telkens '${targetType}' verwacht`);
  const allTypes3 = (targetType: TypeType) => (t1: TypeType, t2: TypeType, t3: TypeType) =>
    t1 === targetType && t2 === targetType && t3 === targetType
      ? ok({})
      : fail(`typecontrole: '${t1}', '${t2}' en '${t3}' gevonden, maar telkens '${targetType}' verwacht`);
  const equalType = (t1: TypeType, t2: TypeType) =>
    t1 === t2 ? ok({}) : fail(`typecontrole: verwacht dat '${t1}' en '${t2}' gelijk zijn`);
  const conditionIsBoolean = (evaluator: TypedEvaluator) =>
    evaluator.typeName === "boolean" ? ok(evaluator) : fail<TypedEvaluator>(`typecontrole: een conditie moet een 'boolean' opleveren`);

  // De expressie op het hoogste niveau moet tot een boolean evalueren
  const compileCondition: (_: Expression) => ValidatedTypedEvaluator = composeValidators2(compile, conditionIsBoolean);

  // Het hart van de compiler
  function compile(expression: Expression): ValidatedTypedEvaluator {
    switch (expression.kind) {
      case "&&":
        return leftRight((a, b) => a && b, allTypes2("boolean"), "boolean", expression);
      case "||":
        return leftRight((a, b) => a || b, allTypes2("boolean"), "boolean", expression);
      case "!":
        return apply1(a => !a, typeIs("boolean"), "boolean", compile(expression.expression));
      case "==":
        return leftRight((a, b) => a === b, equalType, "boolean", expression);
      case "!=":
        return leftRight((a, b) => a !== b, equalType, "boolean", expression);
      case "<":
        return leftRight((a, b) => a < b, allTypes2("number"), "boolean", expression);
      case "<=":
        return leftRight((a, b) => a <= b, allTypes2("number"), "boolean", expression);
      case ">":
        return leftRight((a, b) => a > b, allTypes2("number"), "boolean", expression);
      case ">=":
        return leftRight((a, b) => a >= b, allTypes2("number"), "boolean", expression);
      case "L==":
        return leftRight((a: string, b: string) => a.toLowerCase() === b, allTypes2("string"), "boolean", expression);
      case "PropertyExists":
        return ok(TypedEvaluator(checkFeatureDefined(expression.ref), "boolean"));
      case "EnvironmentExists": {
        const envIsResolution = some(expression.ref === "resolution"); // berekenen at compile time!
        return ok(TypedEvaluator(() => envIsResolution, "boolean"));
      }
      case "<=>":
        return apply3(
          (v, l, u) => v >= l && v <= u,
          allTypes3("number"),
          "boolean",
          compile(expression.value),
          compile(expression.lower),
          compile(expression.upper)
        );
      case "Literal":
        return ok(
          TypedEvaluator(
            () => some(expression.value),
            typeof expression.value as TypeType // Het type van ValueType is TypeType bij constructie
          )
        );
      case "Property":
        return ok(TypedEvaluator(getProperty(expression.ref, expression.type), expression.type));
      case "Environment":
        return expression.ref === "resolution" && expression.type === "number"
          ? ok(TypedEvaluator(getResolution, "number"))
          : fail(`Enkel 'resolution' en type 'number' wordt ondersteund, maar '${expression.ref} en '${expression.type}' zijn gevonden`);
    }
  }

  // Hulpfunctie voor minder codeduplicatie
  function leftRight(
    f: (a1: ValueType, a2: ValueType) => ValueType,
    check: (t1: TypeType, t2: TypeType) => Validation<{}>,
    resultType: TypeType,
    expression: Comparison | Combination
  ) {
    return apply2(f, check, resultType, compile(expression.left), compile(expression.right));
  }

  // Type checking en aaneenrijgen van de lagere boomknopen in een run-time functie
  function apply1(
    f: (a1: ValueType) => ValueType,
    check: (t1: TypeType) => Validation<{}>,
    resultType: TypeType,
    validation1: ValidatedTypedEvaluator
  ): ValidatedTypedEvaluator {
    return chain(validation1, val1 => check(val1.typeName).map(() => TypedEvaluator(liftEvaluator1(f)(val1.evaluator), resultType)));
  }

  function apply2(
    f: (a1: ValueType, a2: ValueType) => ValueType,
    check: (t1: TypeType, t2: TypeType) => Validation<{}>,
    resultType: TypeType,
    validation1: ValidatedTypedEvaluator,
    validation2: ValidatedTypedEvaluator
  ): ValidatedTypedEvaluator {
    return chain(validation1, val1 =>
      chain(validation2, val2 =>
        check(val1.typeName, val2.typeName).map(() => TypedEvaluator(liftEvaluator2(f)(val1.evaluator, val2.evaluator), resultType))
      )
    );
  }

  function apply3(
    f: (a1: ValueType, a2: ValueType, a3: ValueType) => ValueType,
    check: (t1: TypeType, t2: TypeType, t3: TypeType) => Validation<{}>,
    resultType: TypeType,
    validation1: ValidatedTypedEvaluator,
    validation2: ValidatedTypedEvaluator,
    validation3: ValidatedTypedEvaluator
  ): ValidatedTypedEvaluator {
    return chain(validation1, val1 =>
      chain(validation2, val2 =>
        chain(validation3, val3 =>
          check(val1.typeName, val2.typeName, val3.typeName).map(() =>
            TypedEvaluator(liftEvaluator3(f)(val1.evaluator, val2.evaluator, val3.evaluator), resultType)
          )
        )
      )
    );
  }

  // "platte" functies omzetten tot Evaluator functies.
  function liftEvaluator1(f: (v1: ValueType) => ValueType): (ev1: Evaluator) => Evaluator {
    return (ev1: Evaluator) => (ctx: Context) => ev1(ctx).map(r1 => f(r1));
  }

  function liftEvaluator2(f: (v1: ValueType, v2: ValueType) => ValueType): (ev1: Evaluator, ev2: Evaluator) => Evaluator {
    return (ev1: Evaluator, ev2: Evaluator) => (ctx: Context) => ev1(ctx).chain(r1 => ev2(ctx).map(r2 => f(r1, r2)));
  }

  function liftEvaluator3(
    f: (v1: ValueType, v2: ValueType, v3: ValueType) => ValueType
  ): (ev1: Evaluator, ev2: Evaluator, ev3: Evaluator) => Evaluator {
    return (ev1: Evaluator, ev2: Evaluator, ev3: Evaluator) => (ctx: Context) =>
      ev1(ctx).chain(r1 => ev2(ctx).chain(r2 => ev3(ctx).map(r3 => f(r1, r2, r3))));
  }

  type RuleExpression = Function1<Context, Option<ol.style.Style>>;

  // De regels controleren en combineren zodat at run-time ze één voor één geprobeerd worden totdat er een match is
  const validatedCombinedRuleExpression: Validation<RuleExpression> = array.reduce(
    ruleCfg.rules,
    ok(() => none),
    (combinedRuleValidation: Validation<RuleExpression>, rule: RuleStyle) => {
      // Hang een regel bij de vorige regels
      return chain(combinedRuleValidation, combinedRule => {
        // WTF? Deze lambda moet blijkbaar in een {} block zitten of het faalt wanneer gebruikt in externe applicatie.
        // De conditie moet kosjer zijn
        return compileCondition(rule.condition).map(typedEvaluator => (ctx: Context) =>
          combinedRule(ctx).orElse(() => typedEvaluator.evaluator(ctx).chain(outcome => ((outcome as boolean) ? some(rule.style) : none)))
        );
      });
    }
  );

  const styleFunctionFromRuleExpression: Function1<RuleExpression, ol.StyleFunction> = ruleExpression => (
    feature: ol.Feature,
    resolution: number
  ) => ruleExpression({ feature: feature, resolution: resolution }).getOrElse((undefined as any) as ol.style.Style);

  return validatedCombinedRuleExpression.map(styleFunctionFromRuleExpression);
}
