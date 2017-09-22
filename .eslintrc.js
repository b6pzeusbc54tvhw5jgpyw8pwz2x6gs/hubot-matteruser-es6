module.exports = {
  parser: "babel-eslint",
  plugins: ["import"],
  ecmaFeatures: {
    ecamVersion: 6,
    templateStrings: true,
    modules: true,
    classes: true,
    arrowFunctions: true,
    blockBindings: true,
  },
  env: {
    "node": true,
    "es6": true,
  },
  "rules": {
    "semi": [ "warn", "never" ],
    "no-use-before-define": [2, "nofunc"],
    "no-param-reassign": 0,
    "prefer-const": "warn",
  },
  globals: {
    "__DEV__": false
  },
}
