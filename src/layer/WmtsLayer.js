/*
 * Copyright (C) 2015 United States Government as represented by the Administrator of the
 * National Aeronautics and Space Administration. All Rights Reserved.
 */
/**
 * @exports WmtsLayer
 */
define([
        '../util/AbsentResourceList',
        '../error/ArgumentError',
        '../util/Logger',
        '../geom/Sector',
        '../layer/Layer',
        '../cache/MemoryCache',
        '../render/Texture',
        '../util/WmsUrlBuilder',
        '../layer/WmtsLayerTile',
        '../util/WWMath',
        '../util/WWUtil'
    ],
    function (AbsentResourceList,
              ArgumentError,
              Logger,
              Sector,
              Layer,
              MemoryCache,
              Texture,
              WmsUrlBuilder,
              WmtsLayerTile,
              WWMath,
              WWUtil) {
        "use strict";

        // TODO: Test Mercator layers.
        // TODO: Support tile matrix limits.
        // TODO: Extensibility for other projections.
        // TODO: Finish parsing capabilities document (ServiceIdentification and ServiceProvider).
        // TODO: Time dimensions.

        /**
         * Constructs a WMTS image layer.
         * @alias WmtsLayer
         * @constructor
         * @augments Layer
         * @classdesc Displays a WMTS image layer.
         * @param {{}} config Specifies configuration information for the layer. Must contain the following
         * properties:
         * <ul>
         *     <li>title: {String} The title of the layer.</li>
         *     <li>layerIdentifier: {String} The identifier of the layer.</li>
         *     <li>styleIdentifier: {String} The style identifier.</li>
         *     <li>imageFormat: {String} The mime type of the image.</li>
         *     <li>resourceUrl: {String} The REST url template (if supported).</li>
         *     <li>serviceUrl: {String} The KVP url (if supported).</li>
         *     <li>tileMatrixSet: {{}} The WMTS TileMatrixSet object to use for this layer.</li>
         *     <li>boundingBox: {Array} The array of BoundingBox elements for the layer (optional).</li>
         *     <li>wgs84BoundingBox: {{}} The Wgs84BoundingBox element model.</li>
         *     <li>timeString (optional): {String} the time parameter passed to the WMS when imagery is requested. </li>
         * </ul>
         * The function [WmtsLayer.createConfigurationFromLayer]{@link WmsLayer#createConfigurationFromLayer} will create an
         * appropriate configuration object given a {@link WmtsLayerCapabilities} object.
         * @throws {ArgumentError} If the specified configuration is null or undefined.
         */
        var WmtsLayer = function (config) {
            if (!config) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "constructor",
                        "No layer configuration specified."));
            }

            Layer.call(this, "WMTS Layer");

            /**
             * The WMTS layer identifier of this layer.
             * @type {String}
             * @readonly
             */
            this.layerIdentifier = config.layerIdentifier;

            if (!this.layerIdentifier) {
                Logger.logMessage(Logger.LEVEL_WARNING, "WmtsLayer", "constructor",
                    "No layer specified.");
            }

            /**
             * The style identifier specified to this layer's constructor.
             * @type {String}
             * @readonly
             */
            this.styleIdentifier = config.styleIdentifier;

            if (!this.styleIdentifier) {
                Logger.logMessage(Logger.LEVEL_WARNING, "WmtsLayer", "constructor",
                    "No default style available. A style will not be specified in tile requests.");
            }

            /**
             * The time string passed to this layer's constructor.
             * @type {String}
             * @readonly
             */
            this.timeString = config.timeString;

            /**
             * The mime type for images.
             * @type {String}
             * @readonly
             */
            this.imageFormat = config.imageFormat;

            if (!this.imageFormat) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "constructor",
                        "Layer does not provide a supported image format."));
            }

            /**
             * The URL template for accessing REST resources.
             * @type {String}
             * @readonly
             */
            this.resourceUrl = config.resourceUrl;

            /**
             * The URL root for KVP supported resources.
             */
            this.serviceUrl = config.serviceUrl;

            if (!this.resourceUrl && !this.serviceUrl) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "constructor",
                        "No resource URL or KVP GetTile service URL specified in WMTS capabilities."));
            }

            /**
             * The TileMatrixSet object to use for this layer.
             * @type {{}}
             * @readonly
             */
            this.tileMatrixSet = config.tileMatrixSet;

            if (!this.tileMatrixSet) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "constructor",
                        "No supported Tile Matrix Set could be found."));
            }

            // Determine the layer's sector if possible. Mandatory for EPSG:4326 tile matrix sets. (Others compute
            // it from tile Matrix Set metadata.)
            // Sometimes BBOX defined in Matrix and not in Layer
            if (!config.wgs84BoundingBox && !config.boundingBox) {
                if (this.tileMatrixSet.boundingBox) {
                    this.sector = new Sector(
                        config.tileMatrixSet.boundingBox.lowerCorner[1],
                        config.tileMatrixSet.boundingBox.upperCorner[1],
                        config.tileMatrixSet.boundingBox.lowerCorner[0],
                        config.tileMatrixSet.boundingBox.upperCorner[0]);
                } else {
                    // Throw an exception if there is no bounding box.
                    throw new ArgumentError(
                        Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "constructor",
                            "No bounding box was specified in the layer or tile matrix set capabilities."));
                }
            } else if (config.wgs84BoundingBox) {
                this.sector = new Sector(
                    config.wgs84BoundingBox.lowerCorner[1],
                    config.wgs84BoundingBox.upperCorner[1],
                    config.wgs84BoundingBox.lowerCorner[0],
                    config.wgs84BoundingBox.upperCorner[0]);
            } else if (this.tileMatrixSet.boundingBox &&
                WmtsLayer.isEpsg4326Crs(this.tileMatrixSet.boundingBox.crs)) {
                this.sector = new Sector(
                    this.tileMatrixSet.boundingBox.lowerCorner[1],
                    this.tileMatrixSet.boundingBox.upperCorner[1],
                    this.tileMatrixSet.boundingBox.lowerCorner[0],
                    this.tileMatrixSet.boundingBox.upperCorner[0]);
            } else if (WmtsLayer.isEpsg4326Crs(this.tileMatrixSet.supportedCRS)) {

                // Throw an exception if there is no 4326 bounding box.
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "constructor",
                        "No EPSG:4326 bounding box was specified in the layer or tile matrix set capabilities."));
            }

            // Form a unique string to identify cache entries.
            this.cachePath = (this.resourceUrl || this.serviceUrl) +
                this.layerIdentifier + this.styleIdentifier + this.tileMatrixSet.identifier;
            if (this.timeString) {
                this.cachePath = this.cachePath + this.timeString;
            }

            this.displayName = config.title;

            this.pickEnabled = false;

            this.currentTiles = [];
            this.currentTilesInvalid = true;
            this.tileCache = new MemoryCache(500, 400);
            this.currentRetrievals = [];
            this.absentResourceList = new AbsentResourceList(3, 50e3);

            this.pickEnabled = false;

            /**
             * Controls the level of detail switching for this layer. The next highest resolution level is
             * used when an image's texel size is greater than this number of pixels, up to the maximum resolution
             * of this layer.
             * @type {Number}
             * @default 1.75
             */
            this.detailControl = 1.75;
        };

        WmtsLayer.prototype = Object.create(Layer.prototype);

        WmtsLayer.prototype.doRender = function (dc) {
            if (!dc.terrain)
                return;

            if (this.currentTilesInvalid
                || !this.lasTtMVP || !dc.navigatorState.modelviewProjection.equals(this.lasTtMVP)
                || dc.globeStateKey != this.lastGlobeStateKey) {
                this.currentTilesInvalid = false;
                this.assembleTiles(dc);
            }

            this.lasTtMVP = dc.navigatorState.modelviewProjection;
            this.lastGlobeStateKey = dc.globeStateKey;

            if (this.currentTiles.length > 0) {
                dc.surfaceTileRenderer.renderTiles(dc, this.currentTiles, this.opacity);
                dc.frameStatistics.incrementImageTileCount(this.currentTiles.length);
                this.inCurrentFrame = true;
            }
        };

        WmtsLayer.prototype.isLayerInView = function (dc) {
            return dc.terrain && dc.terrain.sector && dc.terrain.sector.intersects(this.sector);
        };

        WmtsLayer.prototype.isTileVisible = function (dc, tile) {
            if (dc.globe.projectionLimits && !tile.sector.overlaps(dc.globe.projectionLimits)) {
                return false;
            }

            return tile.extent.intersectsFrustum(dc.navigatorState.frustumInModelCoordinates);
        };

        WmtsLayer.prototype.assembleTiles = function (dc) {
            this.currentTiles = [];

            if (!this.topLevelTiles || (this.topLevelTiles.length === 0)) {
                this.createTopLevelTiles(dc);
            }

            for (var i = 0, len = this.topLevelTiles.length; i < len; i++) {
                var tile = this.topLevelTiles[i];

                tile.update(dc);

                this.currentAncestorTile = null;

                if (this.isTileVisible(dc, tile)) {
                    this.addTileOrDescendants(dc, tile);
                }
            }
        };

        WmtsLayer.prototype.addTileOrDescendants = function (dc, tile) {
            if (this.tileMeetsRenderingCriteria(dc, tile)) {
                this.addTile(dc, tile);
                return;
            }

            var ancestorTile = null;

            try {
                if (this.isTileTextureInMemory(dc, tile) || tile.tileMatrix.levelNumber === 0) {
                    ancestorTile = this.currentAncestorTile;
                    this.currentAncestorTile = tile;
                }

                var nextLevel = this.tileMatrixSet.tileMatrix[tile.tileMatrix.levelNumber + 1],
                    subTiles = tile.subdivideToCache(nextLevel, this, this.tileCache);

                for (var i = 0, len = subTiles.length; i < len; i++) {
                    var child = subTiles[i];

                    child.update(dc);

                    if (this.sector.intersects(child.sector) && this.isTileVisible(dc, child)) {
                        this.addTileOrDescendants(dc, child);
                    }
                }
            } finally {
                if (ancestorTile) {
                    this.currentAncestorTile = ancestorTile;
                }
            }
        };

        WmtsLayer.prototype.addTile = function (dc, tile) {
            tile.fallbackTile = null;

            var texture = dc.gpuResourceCache.resourceForKey(tile.imagePath);
            if (texture) {
                this.currentTiles.push(tile);

                // If the tile's texture has expired, cause it to be re-retrieved. Note that the current,
                // expired texture is still used until the updated one arrives.
                if (this.expiration && this.isTextureExpired(texture)) {
                    this.retrieveTileImage(dc, tile);
                }

                return;
            }

            this.retrieveTileImage(dc, tile);

            if (this.currentAncestorTile) {
                if (this.isTileTextureInMemory(dc, this.currentAncestorTile)) {
                    this.currentTiles.push(this.currentAncestorTile);
                }
            }
        };

        WmtsLayer.prototype.isTextureExpired = function (texture) {
            return this.expiration && (texture.creationTime.getTime() <= this.expiration.getTime());
        };

        WmtsLayer.prototype.isTileTextureInMemory = function (dc, tile) {
            return dc.gpuResourceCache.containsResource(tile.imagePath);
        };

        WmtsLayer.prototype.tileMeetsRenderingCriteria = function (dc, tile) {
            var s = this.detailControl;
            if (tile.sector.minLatitude >= 75 || tile.sector.maxLatitude <= -75) {
                s *= 1.2;
            }
            return tile.tileMatrix.levelNumber === (this.tileMatrixSet.tileMatrix.length - 1) || !tile.mustSubdivide(dc, s);
        };

        WmtsLayer.prototype.retrieveTileImage = function (dc, tile) {
            if (this.currentRetrievals.indexOf(tile.imagePath) < 0) {
                if (this.absentResourceList.isResourceAbsent(tile.imagePath)) {
                    return;
                }

                var url = this.resourceUrlForTile(tile, this.imageFormat),
                    image = new Image(),
                    imagePath = tile.imagePath,
                    cache = dc.gpuResourceCache,
                    canvas = dc.currentGlContext.canvas,
                    layer = this;

                if (!url) {
                    this.currentTilesInvalid = true;
                    return;
                }

                image.onload = function () {
                    Logger.log(Logger.LEVEL_INFO, "Image retrieval succeeded: " + url);
                    var texture = layer.createTexture(dc, tile, image);
                    layer.removeFromCurrentRetrievals(imagePath);

                    if (texture) {
                        cache.putResource(imagePath, texture, texture.size);

                        layer.currentTilesInvalid = true;
                        layer.absentResourceList.unmarkResourceAbsent(imagePath);

                        // Send an event to request a redraw.
                        var e = document.createEvent('Event');
                        e.initEvent(WorldWind.REDRAW_EVENT_TYPE, true, true);
                        canvas.dispatchEvent(e);
                    }
                };

                image.onerror = function () {
                    layer.removeFromCurrentRetrievals(imagePath);
                    layer.absentResourceList.markResourceAbsent(imagePath);
                    Logger.log(Logger.LEVEL_WARNING, "Image retrieval failed: " + url);
                };

                this.currentRetrievals.push(imagePath);
                image.crossOrigin = 'anonymous';
                image.src = url;
            }
        };

        WmtsLayer.prototype.resourceUrlForTile = function (tile, imageFormat) {
            var url;

            if (this.resourceUrl) {
                url = this.resourceUrl.replace("{Style}", this.styleIdentifier).
                    replace("{TileMatrixSet}", this.tileMatrixSet.identifier).
                    replace("{TileMatrix}", tile.tileMatrix.identifier).
                    replace("{TileCol}", tile.column).replace("{TileRow}", tile.row);

                if (this.timeString) {
                    url = url.replace("{Time}", this.timeString);
                }
            } else {
                url = this.serviceUrl + "service=WMTS&request=GetTile&version=1.0.0";

                url += "&Layer=" + this.layerIdentifier;

                if (this.styleIdentifier) {
                    url += "&Style=" + this.styleIdentifier;
                }

                url += "&Format=" + imageFormat;

                if (this.timeString) {
                    url += "&Time=" + this.timeString;
                }

                url += "&TileMatrixSet=" + this.tileMatrixSet.identifier;
                url += "&TileMatrix=" + tile.tileMatrix.identifier;
                url += "&TileRow=" + tile.row;
                url += "&TileCol=" + tile.column;
            }

            return url;
        };

        WmtsLayer.prototype.removeFromCurrentRetrievals = function (imagePath) {
            var index = this.currentRetrievals.indexOf(imagePath);
            if (index > -1) {
                this.currentRetrievals.splice(index, 1);
            }
        };

        WmtsLayer.prototype.createTopLevelTiles = function (dc) {
            var tileMatrix = this.tileMatrixSet.tileMatrix[0];

            this.topLevelTiles = [];

            for (var j = 0; j < tileMatrix.matrixHeight; j++) {
                for (var i = 0; i < tileMatrix.matrixWidth; i++) {
                    this.topLevelTiles.push(this.createTile(tileMatrix, j, i));
                }
            }
        };

        WmtsLayer.prototype.createTile = function (tileMatrix, row, column) {
            if (WmtsLayer.isEpsg4326Crs(this.tileMatrixSet.supportedCRS)) {
                return this.createTile4326(tileMatrix, row, column);
            } else if (WmtsLayer.isEpsg3857Crs(this.tileMatrixSet.supportedCRS)) {
                return this.createTile3857(tileMatrix, row, column);
            } else if (WmtsLayer.isOGCCrs84(this.tileMatrixSet.supportedCRS)) {
                return this.createTileCrs84(tileMatrix, row, column);
            }
        };

        WmtsLayer.prototype.createTile4326 = function (tileMatrix, row, column) {
            var tileDeltaLat = this.sector.deltaLatitude() / tileMatrix.matrixHeight, // TODO: calculate from metadata
                tileDeltaLon = this.sector.deltaLongitude() / tileMatrix.matrixWidth,
                maxLat = tileMatrix.topLeftCorner[0] - row * tileDeltaLat,
                minLat = maxLat - tileDeltaLat,
                minLon = tileMatrix.topLeftCorner[1] + tileDeltaLon * column,
                maxLon = minLon + tileDeltaLon;

            var sector = new Sector(minLat, maxLat, minLon, maxLon);

            return this.makeTile(sector, tileMatrix, row, column);
        };

        WmtsLayer.prototype.createTileCrs84 = function (tileMatrix, row, column) {
            var tileDeltaLat = this.sector.deltaLatitude() / tileMatrix.matrixHeight,
                tileDeltaLon = this.sector.deltaLongitude() / tileMatrix.matrixWidth,
                maxLat = tileMatrix.topLeftCorner[1] - row * tileDeltaLat,
                minLat = maxLat - tileDeltaLat,
                minLon = tileMatrix.topLeftCorner[0] + tileDeltaLon * column,
                maxLon = minLon + tileDeltaLon;

            var sector = new Sector(minLat, maxLat, minLon, maxLon);

            return this.makeTile(sector, tileMatrix, row, column);
        };

        WmtsLayer.prototype.createTile3857 = function (tileMatrix, row, column) {
            if (!tileMatrix.mapWidth) {
                this.computeTileMatrixValues3857(tileMatrix);
            }

            var swX = WWMath.clamp(column * tileMatrix.tileWidth - 0.5, 0, tileMatrix.mapWidth),
                neY = WWMath.clamp(row * tileMatrix.tileHeight - 0.5, 0, tileMatrix.mapHeight),
                neX = WWMath.clamp(swX + (tileMatrix.tileWidth) + 0.5, 0, tileMatrix.mapWidth),
                swY = WWMath.clamp(neY + (tileMatrix.tileHeight) + 0.5, 0, tileMatrix.mapHeight),
                x, y, swLat, swLon, neLat, neLon;

            x = swX / tileMatrix.mapWidth;
            y = swY / tileMatrix.mapHeight;
            swLon = tileMatrix.topLeftCorner[0] + x * tileMatrix.tileMatrixDeltaX;
            swLat = tileMatrix.topLeftCorner[1] - y * tileMatrix.tileMatrixDeltaY;
            var swDegrees = WWMath.epsg3857ToEpsg4326(swLon, swLat);

            x = neX / tileMatrix.mapWidth;
            y = neY / tileMatrix.mapHeight;
            neLon = tileMatrix.topLeftCorner[0] + x * tileMatrix.tileMatrixDeltaX;
            neLat = tileMatrix.topLeftCorner[1] - y * tileMatrix.tileMatrixDeltaY;
            var neDegrees = WWMath.epsg3857ToEpsg4326(neLon, neLat);

            var sector = new Sector(swDegrees[0], neDegrees[0], swDegrees[1], neDegrees[1]);

            return this.makeTile(sector, tileMatrix, row, column);
        };

        WmtsLayer.prototype.computeTileMatrixValues3857 = function (tileMatrix) {
            var pixelSpan = tileMatrix.scaleDenominator * 0.28e-3,
                tileSpanX = tileMatrix.tileWidth * pixelSpan,
                tileSpanY = tileMatrix.tileHeight * pixelSpan,
                tileMatrixMaxX = tileMatrix.topLeftCorner[0] + tileSpanX * tileMatrix.matrixWidth,
                tileMatrixMinY = tileMatrix.topLeftCorner[1] - tileSpanY * tileMatrix.matrixHeight,
                bottomRightCorner = [tileMatrixMaxX, tileMatrixMinY],
                topLeftCorner = tileMatrix.topLeftCorner;

            tileMatrix.tileMatrixDeltaX = bottomRightCorner[0] - topLeftCorner[0];
            tileMatrix.tileMatrixDeltaY = topLeftCorner[1] - bottomRightCorner[1];
            tileMatrix.mapWidth = tileMatrix.tileWidth * tileMatrix.matrixWidth;
            tileMatrix.mapHeight = tileMatrix.tileHeight * tileMatrix.matrixHeight;
        };

        WmtsLayer.prototype.makeTile = function (sector, tileMatrix, row, column) {
            var path = this.cachePath + "-layer/" + tileMatrix.identifier + "/" + row + "/" + column + "."
                + WWUtil.suffixForMimeType(this.imageFormat);

            return new WmtsLayerTile(sector, tileMatrix, row, column, path);
        };

        WmtsLayer.prototype.createTexture = function (dc, tile, image) {
            if (WmtsLayer.isEpsg4326Crs(this.tileMatrixSet.supportedCRS)) {
                return new Texture(dc.currentGlContext, image);
            } else if (WmtsLayer.isEpsg3857Crs(this.tileMatrixSet.supportedCRS)) {
                return this.createTexture3857(dc, tile, image);
            } else if (WmtsLayer.isOGCCrs84(this.tileMatrixSet.supportedCRS)) {
                return new Texture(dc.currentGlContext, image);
            }
        };

        WmtsLayer.prototype.createTexture3857 = function (dc, tile, image) {
            if (!this.destCanvas) {
                // Create a canvas we can use when unprojecting retrieved images.
                this.destCanvas = document.createElement("canvas");
                this.destContext = this.destCanvas.getContext("2d");
            }

            var srcCanvas = dc.canvas2D,
                srcContext = dc.ctx2D,
                srcImageData,
                destCanvas = this.destCanvas,
                destContext = this.destContext,
                destImageData = destContext.createImageData(image.width, image.height),
                sector = tile.sector,
                tMin = WWMath.gudermannianInverse(sector.minLatitude),
                tMax = WWMath.gudermannianInverse(sector.maxLatitude),
                lat, g, srcRow, kSrc, kDest, sy, dy;

            srcCanvas.width = image.width;
            srcCanvas.height = image.height;
            destCanvas.width = image.width;
            destCanvas.height = image.height;

            // Draw the original image to a canvas so image data can be had for it.
            srcContext.drawImage(image, 0, 0, image.width, image.height);
            srcImageData = srcContext.getImageData(0, 0, image.width, image.height);

            // Unproject the retrieved image.
            for (var n = 0; n < 1; n++) {
                for (var y = 0; y < image.height; y++) {
                    sy = 1 - y / (image.height - 1);
                    lat = sy * sector.deltaLatitude() + sector.minLatitude;
                    g = WWMath.gudermannianInverse(lat);
                    dy = 1 - (g - tMin) / (tMax - tMin);
                    dy = WWMath.clamp(dy, 0, 1);
                    srcRow = Math.floor(dy * (image.height - 1));
                    for (var x = 0; x < image.width; x++) {
                        kSrc = 4 * (x + srcRow * image.width);
                        kDest = 4 * (x + y * image.width);

                        destImageData.data[kDest] = srcImageData.data[kSrc];
                        destImageData.data[kDest + 1] = srcImageData.data[kSrc + 1];
                        destImageData.data[kDest + 2] = srcImageData.data[kSrc + 2];
                        destImageData.data[kDest + 3] = srcImageData.data[kSrc + 3];
                    }
                }
            }

            destContext.putImageData(destImageData, 0, 0);

            return new Texture(dc.currentGlContext, destCanvas);
        };

        WmtsLayer.isEpsg4326Crs = function (crs) {
            return (crs.indexOf("EPSG") >= 0) && (crs.indexOf("4326") >= 0);
        };

        WmtsLayer.isEpsg3857Crs = function (crs) {
            return (crs.indexOf("EPSG") >= 0)
                && ((crs.indexOf("3857") >= 0) || (crs.indexOf("900913") >= 0)); // 900913 is google's 3857 alias
        };

        WmtsLayer.isOGCCrs84 = function (crs) {
            return (crs.indexOf("OGC") >= 0) && (crs.indexOf("CRS84") >= 0);
        };

        WmtsLayer.convertTileMatrixSets = function (layerCaps) {
            if (!layerCaps) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "convertTileMatrixSets",
                        "No layer configuration specified."));
            }

            var convertedTileMatrixSets = [];

            var tileMatrixSets = layerCaps.getLayerSupportedTileMatrixSets();
            for (var i = 0, len = tileMatrixSets.length; i < len; i++) {
                var tileMatrixSet = tileMatrixSets[i];

                // Check coordinate system
                var crs = tileMatrixSet.supportedCRS;
                if (!(WmtsLayer.isEpsg4326Crs(crs) || WmtsLayer.isEpsg3857Crs(crs) || WmtsLayer.isOGCCrs84(crs))) {
                    continue;
                }

                var compatibleTileMatrices = [];
                var previousHeight = 0;
                for (var j = 0, tileMatrixLength = tileMatrixSet.tileMatrix.length; j < tileMatrixLength; j++) {
                    var tileMatrix = tileMatrixSet.tileMatrix[j];

                    if (j === 0) {
                        compatibleTileMatrices.push(tileMatrix);
                        continue;
                    }

                    // TODO Check top left corner values

                    // Aspect ratio check - dependent on crs
                    if (WmtsLayer.isEpsg3857Crs(crs)) {
                        if (tileMatrix.matrixHeight != tileMatrix.matrixWidth) {
                            continue;
                        }
                    } else if (WmtsLayer.isEpsg4326Crs(crs) || WmtsLayer.isOGCCrs84(crs)) {
                        if ((tileMatrix.matrixHeight * 2) != tileMatrix.matrixWidth) {
                            continue;
                        }
                    } else {
                        continue;
                    }

                    // Quad division check
                    if ((tileMatrix.matrixHeight % 2 != 0) || (tileMatrix.matrixWidth % 2 != 0)) {
                        continue;
                    }

                    // Image Squareness
                    if (tileMatrix.tileHeight != tileMatrix.tileWidth) {
                        continue;
                    }

                    // Image Size
                    if (tileMatrix.tileHeight != 256) {
                        continue;
                    }

                    // Ensure quad division behavior from previous tile matrix and add compatible tile matrix
                    if ((previousHeight == 0) || ((2 * previousHeight) == tileMatrix.matrixHeight)) {
                        previousHeight = tileMatrix.matrixHeight;
                        compatibleTileMatrices.push(tileMatrix);
                    }
                }

                if (compatibleTileMatrices.length > 1) {
                    var convertedTileMatrixSet = {};
                    convertedTileMatrixSet.identifier = tileMatrixSet.identifier;
                    convertedTileMatrixSet.supportedCRS = tileMatrixSet.supportedCRS;
                    if (tileMatrixSet.wellKnownScaleSet) {
                        convertedTileMatrixSet.wellKnownScaleSet = tileMatrixSet.wellKnownScaleSet;
                    }
                    if (tileMatrixSet.boundingBox) {
                        convertedTileMatrixSet.boundingBox = tileMatrixSet.boundingBox;
                    }
                    convertedTileMatrixSet.tileMatrix = compatibleTileMatrices;
                    convertedTileMatrixSets.push(convertedTileMatrixSet);
                }

            }

            return convertedTileMatrixSets;
        };

        /**
         *
         * @param layerCaps {WmtsLayerCapabilities}
         */
        WmtsLayer.createConfigurationFromLayer = function (layerCaps) {
            if (!layerCaps) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "createConfigurationFromLayer",
                        "No layer configuration specified."));
            }

            var config = {
                layerIdentifier: layerCaps.identifier
            };

            // Set a default style if one is specified in the capabilities document
            for (var i = 0; i < layerCaps.style.length; i++) {
                var style = layerCaps.style[i];

                if (style.isDefault) {
                    config.styleIdentifier = style.identifier;
                    break;
                }
            }

            if (!config.styleIdentifier) {
                Logger.logMessage(Logger.LEVEL_WARNING, "WmtsLayer", "createConfigurationFromLayer",
                    "No default style available. A style will not be specified in tile requests.");
            }

            // Attempt to define a default timeString from available dimensions
            if (layerCaps.dimension) {
                for (var i = 0; i < layerCaps.dimension.length; i++) {
                    if (layerCaps.dimension[i].identifier.toLowerCase() === "time") {
                        config.timeString = layerCaps.dimension[i].default;
                        break;
                    }
                }
            }

            // Determine image format
            var formats = layerCaps.format;

            if (formats.indexOf("image/png") >= 0) {
                config.imageFormat = "image/png";
            } else if (formats.indexOf("image/jpeg") >= 0) {
                config.imageFormat = "image/jpeg";
            } else if (formats.indexOf("image/tiff") >= 0) {
                config.imageFormat = "image/tiff";
            } else if (formats.indexOf("image/gif") >= 0) {
                config.imageFormat = "image/gif";
            } else {
                config.imageFormat = formats[0];
            }

            if (!config.imageFormat) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "createConfigurationFromLayer",
                        "Layer does not provide a supported image format."));
            }

            if (layerCaps.resourceUrl && (layerCaps.resourceUrl.length > 0)) {
                for (var i = 0; i < layerCaps.resourceUrl.length; i++) {
                    if (config.imageFormat === layerCaps.resourceUrl[i].format) {
                        config.resourceUrl = layerCaps.resourceUrl[i].template;
                        break;
                    }
                }
            } else { // resource-oriented interface not supported, so use KVP interface
                config.serviceUrl = layerCaps.capabilities.getGetTileKvpAddress();
                if (config.serviceUrl) {
                    config.serviceUrl = WmsUrlBuilder.fixGetMapString(config.serviceUrl);
                }
            }

            if (!config.resourceUrl && !config.serviceUrl) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "createConfigurationFromLayer",
                        "No resource URL or KVP GetTile service URL specified in WMTS capabilities."));
            }

            var compatibleTileMatrixSets = WmtsLayer.convertTileMatrixSets(layerCaps);
            if (compatibleTileMatrixSets.length > 0) {
                // Find the TileMatrixSet with the greatest number layers
                var highestResTileMatrixSet = null;
                for (var i = 0; i < compatibleTileMatrixSets.length; i++) {
                    var tms = compatibleTileMatrixSets[i];
                    if (!highestResTileMatrixSet) {
                        highestResTileMatrixSet = tms;
                    } else {
                        if (tms.tileMatrix.length > highestResTileMatrixSet.length) {
                            highestResTileMatrixSet = tms;
                        }
                    }
                }
                config.tileMatrixSet = tms;
            } else {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "WmtsLayer", "createConfigurationFromLayer",
                        "No supported Tile Matrix Set could be found."));
            }

            // Configure boundingBox
            config.boundingBox = layerCaps.boundingBox;
            config.wgs84BoundingBox = layerCaps.wgs84BoundingBox;

            // Determine a default display name.
            if (layerCaps.titles.length > 0) {
                config.title = layerCaps.titles[0].value;
            } else {
                config.title = layerCaps.identifier;
            }

            return config;
        };

        return WmtsLayer;
    });