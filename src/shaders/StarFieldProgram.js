/*
 * Copyright (C) 2014 United States Government as represented by the Administrator of the
 * National Aeronautics and Space Administration. All Rights Reserved.
 */
/**
 * @exports StarFieldProgram
 */
define([
        '../error/ArgumentError',
        '../shaders/GpuProgram',
        '../util/Logger'
    ],
    function (ArgumentError,
              GpuProgram,
              Logger) {
        "use strict";

        /**
         * Constructs a new program.
         * Initializes, compiles and links this GLSL program with the source code for its vertex and fragment shaders.
         * <p>
         * This method creates WebGL shaders for the program's shader sources and attaches them to a new GLSL program.
         * This method then compiles the shaders and then links the program if compilation is successful.
         * Use the bind method to make the program current during rendering.
         *
         * @alias StarFieldProgram
         * @constructor
         * @augments GpuProgram
         * @classdesc StarFieldProgram is a GLSL program that draws points representing stars.
         * @param {WebGLRenderingContext} gl The current WebGL context.
         * @throws {ArgumentError} If the shaders cannot be compiled, or linking of the compiled shaders into a program
         * fails.
         */
        var StarFieldProgram = function (gl) {
            var vertexShaderSource =
                    //.x = declination
                    //.y = right ascension
                    //.z = point size
                    //.w = magnitude
                    'attribute vec4 vertexPoint;\n' +

                    'uniform mat4 mvpMatrix;\n' +
                    //number of days (positive or negative) since Greenwich noon, Terrestrial Time,
                    // on 1 January 2000 (J2000.0)
                    'uniform float numDays;\n' +
                    'uniform vec2 magnitudeRange;\n' +

                    'varying float magnitudeWeight;\n' +

                    //normalizes an angle between 0.0 and 359.0
                    'float normalizeAngle(float angle) {\n' +
                    '   float angleDivisions = angle / 360.0;\n' +
                    '   return 360.0 * (angleDivisions - floor(angleDivisions));\n' +
                    '}\n' +

                    //transforms declination and right ascension in cartesian coordinates
                    'vec3 computePosition(float dec, float ra) {\n' +
                    '   float GMST = normalizeAngle(280.46061837 + 360.98564736629 * numDays);\n' +
                    '   float lon = 180.0 - normalizeAngle(GMST - ra);\n' +
                    '   float latRad = radians(dec);\n' +
                    '   float lonRad = radians(lon);\n' +
                    '   float radCosLat = cos(latRad);\n' +
                    '   return vec3(radCosLat * sin(lonRad), sin(latRad), radCosLat * cos(lonRad));\n' +
                    '}\n' +

                    //normalizes a value between 0.0 and 1.0
                    'float normalizeScalar(float value, float minValue, float maxValue){\n' +
                    '   return (value - minValue) / (maxValue - minValue);\n' +
                    '}\n' +

                    'void main() {\n' +
                    '   vec3 vertexPosition = computePosition(vertexPoint.x, vertexPoint.y);\n' +
                    '   gl_Position = mvpMatrix * vec4(vertexPosition.xyz, 1.0);\n' +
                    '   gl_Position.z = gl_Position.w - 0.00001;\n' +
                    '   gl_PointSize = vertexPoint.z;\n' +
                    '   magnitudeWeight = normalizeScalar(vertexPoint.w, magnitudeRange.x, magnitudeRange.y);\n' +
                    '}',
                fragmentShaderSource =
                    'precision mediump float;\n' +

                    'varying float magnitudeWeight;\n' +

                    'const vec4 white = vec4(1.0, 1.0, 1.0, 1.0);\n' +
                    'const vec4 grey = vec4(0.5, 0.5, 0.5, 1.0);\n' +

                    'void main() {\n' +
                    //paint the starts in shades of grey
                    //the brightest star is white and the dimmest star is grey
                    '   gl_FragColor = mix(white, grey, magnitudeWeight);\n' +
                    '}';

            // Call to the superclass, which performs shader program compiling and linking.
            GpuProgram.call(this, gl, vertexShaderSource, fragmentShaderSource, ["vertexPoint"]);

            /**
             * The WebGL location for this program's 'vertexPoint' attribute.
             * @type {Number}
             * @readonly
             */
            this.vertexPointLocation = this.attributeLocation(gl, "vertexPoint");

            /**
             * The WebGL location for this program's 'mvpMatrix' uniform.
             * @type {WebGLUniformLocation}
             * @readonly
             */
            this.mvpMatrixLocation = this.uniformLocation(gl, "mvpMatrix");

            /**
             * The WebGL location for this program's 'numDays' uniform.
             * @type {WebGLUniformLocation}
             * @readonly
             */
            this.numDaysLocation = this.uniformLocation(gl, "numDays");

            /**
             * The WebGL location for this program's 'magnitudeRangeLocation' uniform.
             * @type {WebGLUniformLocation}
             * @readonly
             */
            this.magnitudeRangeLocation = this.uniformLocation(gl, "magnitudeRange");
        };

        /**
         * A string that uniquely identifies this program.
         * @type {string}
         * @readonly
         */
        StarFieldProgram.key = "WorldWindGpuStarFieldProgram";

        // Inherit from GpuProgram.
        StarFieldProgram.prototype = Object.create(GpuProgram.prototype);

        /**
         * Loads the specified matrix as the value of this program's 'mvpMatrix' uniform variable.
         *
         * @param {WebGLRenderingContext} gl The current WebGL context.
         * @param {Matrix} matrix The matrix to load.
         * @throws {ArgumentError} If the specified matrix is null or undefined.
         */
        StarFieldProgram.prototype.loadModelviewProjection = function (gl, matrix) {
            if (!matrix) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "StarFieldProgram", "loadModelviewProjection", "missingMatrix"));
            }

            this.loadUniformMatrix(gl, matrix, this.mvpMatrixLocation);
        };

        /**
         * Loads the specified number as the value of this program's 'numDays' uniform variable.
         *
         * @param {WebGLRenderingContext} gl The current WebGL context.
         * @param {Number} numDays The number of days (positive or negative) since Greenwich noon, Terrestrial Time,
         * on 1 January 2000 (J2000.0)
         * @throws {ArgumentError} If the specified number is null or undefined.
         */
        StarFieldProgram.prototype.loadNumDays = function (gl, numDays) {
            if (numDays == null) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "StarFieldProgram", "loadNumDays", "missingNumDays"));
            }
            gl.uniform1f(this.numDaysLocation, numDays);
        };

        /**
         * Loads the specified number as the value of this program's 'numDays' uniform variable.
         *
         * @param {WebGLRenderingContext} gl The current WebGL context.
         * @param {Number} minMag
         * @param {Number} maxMag
         * @throws {ArgumentError} If the specified numbers are null or undefined.
         */
        StarFieldProgram.prototype.loadMagnitudeRange = function (gl, minMag, maxMag) {
            if (minMag == null) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "StarFieldProgram", "loadMagRange", "missingMinMag"));
            }
            if (maxMag == null) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "StarFieldProgram", "loadMagRange", "missingMaxMag"));
            }
            gl.uniform2f(this.magnitudeRangeLocation, minMag, maxMag);
        };

        return StarFieldProgram;
    });