"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * assert
 *
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT license.
 *
 */
var assert = function (cond, message) {
    if (!cond) {
        throw new Error(message || 'Assertion Failed');
    }
};
exports.default = assert;
