'use strict';

var latex = require('../../utils/latex');
var operators = require('../operators');

function factory (type, config, load, typed, math) {
  var Node         = load(require('./Node'));
  var ConstantNode = load(require('./ConstantNode'));
  var SymbolNode   = load(require('./SymbolNode'));
  var FunctionNode = load(require('./FunctionNode'));

  /**
   * @constructor OperatorNode
   * @extends {Node}
   * An operator with two arguments, like 2+3
   *
   * @param {string} op       Operator name, for example '+'
   * @param {string} fn       Function name, for example 'add'
   * @param {Node[]} args     Operator arguments
   */
  function OperatorNode(op, fn, args) {
    if (!(this instanceof OperatorNode)) {
      throw new SyntaxError('Constructor must be called with the new operator');
    }

    //validate input
    if (typeof op !== 'string') {
      throw new TypeError('string expected for parameter "op"');
    }
    if (typeof fn !== 'string') {
      throw new TypeError('string expected for parameter "fn"');
    }
    if (!Array.isArray(args)
        || !args.every(function (node) {return node && node.isNode;})) {
      throw new TypeError('Array containing Nodes expected for parameter "args"');
    }

    this.op = op;
    this.fn = fn;
    this.args = args || [];
  }

  OperatorNode.prototype = new Node();

  OperatorNode.prototype.type = 'OperatorNode';

  OperatorNode.prototype.isOperatorNode = true;

  /**
   * Compile the node to javascript code
   * @param {Object} defs     Object which can be used to define functions
   *                          or constants globally available for the compiled
   *                          expression
   * @param {Object} args     Object with local function arguments, the key is
   *                          the name of the argument, and the value is `true`.
   *                          The object may not be mutated, but must be
   *                          extended instead.
   * @return {string} js
   * @private
   */
  OperatorNode.prototype._compile = function (defs, args) {
    if (!defs.math[this.fn]) {
      throw new Error('Function ' + this.fn + ' missing in provided namespace "math"');
    }

    var jsArgs = this.args.map(function (arg) {
      return arg._compile(defs, args);
    });

    return 'math.' + this.fn + '(' + jsArgs.join(', ') + ')';
  };

  /**
   * Execute a callback for each of the child nodes of this node
   * @param {function(child: Node, path: string, parent: Node)} callback
   */
  OperatorNode.prototype.forEach = function (callback) {
    for (var i = 0; i < this.args.length; i++) {
      callback(this.args[i], 'args[' + i + ']', this);
    }
  };

  /**
   * Create a new OperatorNode having it's childs be the results of calling
   * the provided callback function for each of the childs of the original node.
   * @param {function(child: Node, path: string, parent: Node): Node} callback
   * @returns {OperatorNode} Returns a transformed copy of the node
   */
  OperatorNode.prototype.map = function (callback) {
    var args = [];
    for (var i = 0; i < this.args.length; i++) {
      args[i] = this._ifNode(callback(this.args[i], 'args[' + i + ']', this));
    }
    return new OperatorNode(this.op, this.fn, args);
  };

  /**
   * Create a clone of this node, a shallow copy
   * @return {OperatorNode}
   */
  OperatorNode.prototype.clone = function () {
    return new OperatorNode(this.op, this.fn, this.args.slice(0));
  };

  /**
   * Calculate which parentheses are necessary. Gets an OperatorNode
   * (which is the root of the tree) and an Array of Nodes
   * (this.args) and returns an array where 'true' means that an argument
   * has to be enclosed in parentheses whereas 'false' means the opposite.
   *
   * @param {OperatorNode} root
   * @param {string} parenthesis
   * @param {Node[]} arguments
   * @param {bool}
   * @return {bool[]}
   * @private
   */
  function calculateNecessaryParentheses(root, parenthesis, args, latex) {
    //precedence of the root OperatorNode
    var precedence = operators.getPrecedence(root, parenthesis);
    var associativity = operators.getAssociativity(root, parenthesis);

    if ((parenthesis === 'all') || (args.length > 2)) {
      var parens = [];
      args.forEach(function (arg) {
        switch (arg.getContent().type) { //Nodes that don't need extra parentheses
          case 'ArrayNode':
          case 'ConstantNode':
          case 'SymbolNode':
          case 'ParenthesisNode':
            parens.push(false);
            break;
          default:
            parens.push(true);
        }
      });
      return parens;
    }

    switch (args.length) {
      case 0:
        return [];
      case 1: //unary operators
              //precedence of the operand
        var operandPrecedence = operators.getPrecedence(args[0], parenthesis);

        //handle special cases for LaTeX, where some of the parentheses aren't needed
        if (latex && (operandPrecedence !== null)) {
          var operandIdentifier;
          var rootIdentifier;
          if (parenthesis === 'keep') {
            operandIdentifier = args[0].getIdentifier();
            rootIdentifier = root.getIdentifier();
          }
          else {
            //Ignore Parenthesis Nodes when not in 'keep' mode
            operandIdentifier = args[0].getContent().getIdentifier();
            rootIdentifier = root.getContent().getIdentifier();
          }
          if (operators.properties[precedence][rootIdentifier].latexLeftParens === false) {
            return [false];
          }

          if (operators.properties[operandPrecedence][operandIdentifier].latexParens === false) {
            return [false];
          }
        }

        if (operandPrecedence === null) {
          //if the operand has no defined precedence, no parens are needed
          return [false];
        }

        if (operandPrecedence <= precedence) {
          //if the operands precedence is lower, parens are needed
          return [true];
        }

        //otherwise, no parens needed
        return [false];

      case 2: //binary operators
        var lhsParens; //left hand side needs parenthesis?
        //precedence of the left hand side
        var lhsPrecedence = operators.getPrecedence(args[0], parenthesis);
        //is the root node associative with the left hand side
        var assocWithLhs = operators.isAssociativeWith(root, args[0], parenthesis);

        if (lhsPrecedence === null) {
          //if the left hand side has no defined precedence, no parens are needed
          //FunctionNode for example
          lhsParens = false;
        }
        else if ((lhsPrecedence === precedence) && (associativity === 'right') && !assocWithLhs) {
          //In case of equal precedence, if the root node is left associative
          // parens are **never** necessary for the left hand side.
          //If it is right associative however, parens are necessary
          //if the root node isn't associative with the left hand side
          lhsParens = true;
        }
        else if (lhsPrecedence < precedence) {
          lhsParens = true;
        }
        else {
          lhsParens = false;
        }

        var rhsParens; //right hand side needs parenthesis?
        //precedence of the right hand side
        var rhsPrecedence = operators.getPrecedence(args[1], parenthesis);
        //is the root node associative with the right hand side?
        var assocWithRhs = operators.isAssociativeWith(root, args[1], parenthesis);

        if (rhsPrecedence === null) {
          //if the right hand side has no defined precedence, no parens are needed
          //FunctionNode for example
          rhsParens = false;
        }
        else if ((rhsPrecedence === precedence) && (associativity === 'left') && !assocWithRhs) {
          //In case of equal precedence, if the root node is right associative
          // parens are **never** necessary for the right hand side.
          //If it is left associative however, parens are necessary
          //if the root node isn't associative with the right hand side
          rhsParens = true;
        }
        else if (rhsPrecedence < precedence) {
          rhsParens = true;
        }
        else {
          rhsParens = false;
        }

        //handle special cases for LaTeX, where some of the parentheses aren't needed
        if (latex) {
          var rootIdentifier;
          var lhsIdentifier;
          var rhsIdentifier;
          if (parenthesis === 'keep') {
            rootIdentifier = root.getIdentifier();
            lhsIdentifier = root.args[0].getIdentifier();
            rhsIdentifier = root.args[1].getIdentifier();
          }
          else {
            //Ignore ParenthesisNodes when not in 'keep' mode
            rootIdentifier = root.getContent().getIdentifier();
            lhsIdentifier = root.args[0].getContent().getIdentifier();
            rhsIdentifier = root.args[1].getContent().getIdentifier();
          }

          if (lhsPrecedence !== null) {
            if (operators.properties[precedence][rootIdentifier].latexLeftParens === false) {
              lhsParens = false;
            }

            if (operators.properties[lhsPrecedence][lhsIdentifier].latexParens === false) {
              lhsParens = false;
            }
          }

          if (rhsPrecedence !== null) {
            if (operators.properties[precedence][rootIdentifier].latexRightParens === false) {
              rhsParens = false;
            }

            if (operators.properties[rhsPrecedence][rhsIdentifier].latexParens === false) {
              rhsParens = false;
            }
          }
        }

        return [lhsParens, rhsParens];
    }
  }

  /**
   * Get string representation.
   * @param {Object} options
   * @return {string} str
   */
  OperatorNode.prototype._toString = function (options) {
    var parenthesis = (options && options.parenthesis) ? options.parenthesis : 'keep';
    var args = this.args;
    var parens = calculateNecessaryParentheses(this, parenthesis, args, false);

    switch (args.length) {
      case 1: //unary operators
        var assoc = operators.getAssociativity(this, parenthesis);

        var operand = args[0].toString(options);
        if (parens[0]) {
          operand = '(' + operand + ')';
        }

        if (assoc === 'right') { //prefix operator
          return this.op + operand;
        }
        else if (assoc === 'left') { //postfix
          return operand + this.op;
        }

        //fall back to postfix
        return operand + this.op;

      case 2:
        var lhs = args[0].toString(options); //left hand side
        var rhs = args[1].toString(options); //right hand side
        if (parens[0]) { //left hand side in parenthesis?
          lhs = '(' + lhs + ')';
        }
        if (parens[1]) { //right hand side in parenthesis?
          rhs = '(' + rhs + ')';
        }

        return lhs + ' ' + this.op + ' ' + rhs;

      default:
        //fallback to formatting as a function call
        return this.fn + '(' + this.args.join(', ') + ')';
    }
  };

  /**
   * Get LaTeX representation
   * @param {Object} options
   * @return {string} str
   */
  OperatorNode.prototype._toTex = function (options) {
    var parenthesis = (options && options.parenthesis) ? options.parenthesis : 'keep';
    var args = this.args;
    var parens = calculateNecessaryParentheses(this, parenthesis, args, true);
    var op = latex.operators[this.fn];
    op = typeof op === 'undefined' ? this.op : op; //fall back to using this.op

    switch (args.length) {
      case 1: //unary operators
        var assoc = operators.getAssociativity(this, parenthesis);

        var operand = args[0].toTex(options);
        if (parens[0]) {
          operand = '\\left(' + operand + '\\right)';
        }

        if (assoc === 'right') { //prefix operator
          return op + operand;
        }
        else if (assoc === 'left') { //postfix operator
          return operand + op;
        }

        //fall back to postfix
        return operand + op;

      case 2: //binary operators
        var lhs = args[0]; //left hand side
        var lhsTex = lhs.toTex(options);
        if (parens[0]) {
          lhsTex = '\\left(' + lhsTex + '\\right)';
        }

        var rhs = args[1]; //right hand side
        var rhsTex = rhs.toTex(options);
        if (parens[1]) {
          rhsTex = '\\left(' + rhsTex + '\\right)';
        }

        //handle some exceptions (due to the way LaTeX works)
        var lhsIdentifier;
        if (parenthesis === 'keep') {
          lhsIdentifier = lhs.getIdentifier();
        }
        else {
          //Ignore ParenthesisNodes if in 'keep' mode
          lhsIdentifier = lhs.getContent().getIdentifier();
        }
        switch (this.getIdentifier()) {
          case 'OperatorNode:divide':
            //op contains '\\frac' at this point
            return op + '{' + lhsTex + '}' + '{' + rhsTex + '}';
          case 'OperatorNode:pow':
            lhsTex = '{' + lhsTex + '}';
            rhsTex = '{' + rhsTex + '}';
            switch (lhsIdentifier) {
              case 'ConditionalNode': //
              case 'OperatorNode:divide':
                lhsTex = '\\left(' + lhsTex + '\\right)';
            }
        }
        return lhsTex + op + rhsTex;

      default:
        //fall back to formatting as a function call
        //as this is a fallback, it doesn't use
        //fancy function names
        return '\\mathrm{' + this.fn + '}\\left('
            + args.map(function (arg) {
              return arg.toTex(options);
            }).join(',') + '\\right)';
    }
  };

  /**
   * Get identifier.
   * @return {string}
   */
  OperatorNode.prototype.getIdentifier = function () {
    return this.type + ':' + this.fn;
  };

  return OperatorNode;
}

exports.name = 'OperatorNode';
exports.path = 'expression.node';
exports.math = true; // request access to the math namespace as 5th argument of the factory function
exports.factory = factory;
