/*
 * Copyright (C) 2014 United States Government as represented by the Administrator of the
 * National Aeronautics and Space Administration. All Rights Reserved.
 */
/**
 * Illustrates how to display and pick Placemarks.
 *
 * @version $Id: PlacemarksAndPicking.js 3320 2015-07-15 20:53:05Z dcollins $
 */

requirejs(['../src/WorldWind',
        './LayerManager',
        './AnnotationController'
    ],
    function (ww,
              LayerManager,
              AnnotationController) {
        "use strict";

        // Tell World Wind to log only warnings.
        WorldWind.Logger.setLoggingLevel(WorldWind.Logger.LEVEL_WARNING);

        // Create the World Window.
        var wwd = new WorldWind.WorldWindow("canvasOne");

        /**
         * Added imagery layers.
         */
        var layers = [
            {layer: new WorldWind.BMNGLayer(), enabled: true},
            {layer: new WorldWind.BMNGLandsatLayer(), enabled: false},
            {layer: new WorldWind.BingAerialWithLabelsLayer(null), enabled: true},
            {layer: new WorldWind.CompassLayer(), enabled: true},
            {layer: new WorldWind.CoordinatesDisplayLayer(wwd), enabled: true},
            {layer: new WorldWind.ViewControlsLayer(wwd), enabled: true}
        ];

        for (var l = 0; l < layers.length; l++) {
            layers[l].layer.enabled = layers[l].enabled;
            wwd.addLayer(layers[l].layer);
        }

        // Define the images we'll use for the placemarks.
        var images = [
            "castshadow-white.png"
        ];

        var pinLibrary = WorldWind.configuration.baseUrl + "images/pushpins/", // location of the image files
            placemark,
            placemarkAttributes = new WorldWind.PlacemarkAttributes(null),
            highlightAttributes,
            placemarkLayer = new WorldWind.RenderableLayer("TestPlacemarks"),
            latitude = 41.451979,
            longitude = -74.437660;

        // Set up the common placemark attributes.
        placemarkAttributes.imageScale = 3;
        placemarkAttributes.imageOffset = new WorldWind.Offset(
            WorldWind.OFFSET_FRACTION, 0.3,
            WorldWind.OFFSET_FRACTION, 0.0);
        placemarkAttributes.imageColor = WorldWind.Color.WHITE;
        placemarkAttributes.labelAttributes.offset = new WorldWind.Offset(
            WorldWind.OFFSET_FRACTION, 0.5,
            WorldWind.OFFSET_FRACTION, 1.0);
        placemarkAttributes.labelAttributes.color = WorldWind.Color.WHITE;
        placemarkAttributes.drawLeaderLine = true;
        placemarkAttributes.leaderLineAttributes.outlineColor = WorldWind.Color.RED;

        // For each placemark image, create a placemark with a label.
        for (var i = 0, len = images.length; i < len; i++) {
            // Create the placemark and its label.
            placemark = new WorldWind.Placemark(new WorldWind.Position(latitude, longitude + i, 1e2), true, null);
            placemark.label = "Fei Tian Academy of the Arts" + "\n"
                + "Lat " + placemark.position.latitude.toPrecision(4).toString() + "\n"
                + "Lon " + placemark.position.longitude.toPrecision(5).toString();
            placemark.altitudeMode = WorldWind.RELATIVE_TO_GROUND;

            // Create the placemark attributes for this placemark. Note that the attributes differ only by their
            // image URL.
            placemarkAttributes = new WorldWind.PlacemarkAttributes(placemarkAttributes);
            placemarkAttributes.imageSource = pinLibrary + images[i];
            placemark.attributes = placemarkAttributes;

            // Create the highlight attributes for this placemark. Note that the normal attributes are specified as
            // the default highlight attributes so that all properties are identical except the image scale. You could
            // instead vary the color, image, or other property to control the highlight representation.
            highlightAttributes = new WorldWind.PlacemarkAttributes(placemarkAttributes);
            highlightAttributes.imageScale = 3.7;
            placemark.highlightAttributes = highlightAttributes;

            // Add the placemark to the layer.
            placemarkLayer.addRenderable(placemark);
        }

        // Add the placemarks layer to the World Window's layer list.
        wwd.addLayer(placemarkLayer);


        var annotationsLayer = new WorldWind.RenderableLayer("TestAnnotations");

        //       var annotationController = new AnnotationController(wwd);

        //       var layerManger = new LayerManager(wwd);

        var locations = [
            new WorldWind.Position(45.759506, 21.227948, 1e2),
            new WorldWind.Position(39.238384, 58.331522, 1e2),
            new WorldWind.Position(62.905780, 93.247174, 1e2),
            new WorldWind.Position(54.560028, -102.221517, 1e2),
            new WorldWind.Position(40.964231, -103.627767, 1e2),
            new WorldWind.Position(72.913535, -41.752785, 1e2),
            new WorldWind.Position(-22.061476, 133.611391, 1e2),
            new WorldWind.Position(-11.820326, -66.076097, 1e2),
            new WorldWind.Position(7.061353, 10.212961, 1e2)
        ];

        var annotations = [],
            annotation,
            annotationAttributes,
            insets;

        var backgroundColors = [
            WorldWind.Color.RED,
            WorldWind.Color.GREEN,
            WorldWind.Color.MAGENTA,
            WorldWind.Color.BLUE,
            WorldWind.Color.DARK_GRAY,
            WorldWind.Color.BLACK,
            WorldWind.Color.BLACK,
            WorldWind.Color.RED,
            WorldWind.Color.BLACK,
            WorldWind.Color.BLACK,
            WorldWind.Color.BLACK];

        for (var z = 0; z < locations.length; z++) {
            annotationAttributes = new WorldWind.AnnotationAttributes(null);
            annotationAttributes.cornerRadius = 14;
            annotationAttributes.backgroundColor = backgroundColors[z];
            annotationAttributes.textColor = new WorldWind.Color(1, 1, 1, 1);
            annotationAttributes.drawLeader = true;
            annotationAttributes.leaderGapWidth = 40;
            annotationAttributes.leaderGapHeight = 30;
            annotationAttributes.opacity = 1;
            annotationAttributes.scale = 1;
            annotationAttributes.width = 200;
            annotationAttributes.height = 100;
            annotationAttributes.textAttributes.color = WorldWind.Color.WHITE;
            annotationAttributes.insets = new WorldWind.Insets(10, 10, 10, 10);

            annotation = new WorldWind.Annotation(locations[z], annotationAttributes);
            annotation.label = "Lorem Ipsum is simply dummy text of the printing and typesetting industry.";
            annotations.push(annotation);
            annotationsLayer.addRenderable(annotation);
        }

        // Add the annotations layer to the World Window's layer list.
        wwd.addLayer(annotationsLayer);


        var layerManger = new LayerManager(wwd);

        // Now set up to handle picking.

        var highlightedItems = [];

        // The common pick-handling function.
        var handlePick = function (o) {
            // The input argument is either an Event or a TapRecognizer. Both have the same properties for determining
            // the mouse or tap location.
            var x = o.clientX,
                y = o.clientY;

            var redrawRequired = highlightedItems.length > 0; // must redraw if we de-highlight previously picked items

            // De-highlight any previously highlighted placemarks.
            for (var h = 0; h < highlightedItems.length; h++) {
                highlightedItems[h].highlighted = false;
            }
            highlightedItems = [];

            // Perform the pick. Must first convert from window coordinates to canvas coordinates, which are
            // relative to the upper left corner of the canvas rather than the upper left corner of the page.
            var pickList = wwd.pick(wwd.canvasCoordinates(x, y));
            if (pickList.objects.length > 0) {
                redrawRequired = true;
            }

            // Highlight the items picked by simply setting their highlight flag to true.
            if (pickList.objects.length > 0) {
                for (var p = 0; p < pickList.objects.length; p++) {
                    pickList.objects[p].userObject.highlighted = true;

                    // Keep track of highlighted items in order to de-highlight them later.
                    highlightedItems.push(pickList.objects[p].userObject);

                    // Detect whether the placemark's label was picked. If so, the "labelPicked" property is true.
                    // If instead the user picked the placemark's image, the "labelPicked" property is false.
                    // Applications might use this information to determine whether the user wants to edit the label
                    // or is merely picking the placemark as a whole.
                    if (pickList.objects[p].labelPicked) {
                        console.log("Label picked");
                    }
                }
            }

            // Update the window if we changed anything.
            if (redrawRequired) {
                wwd.redraw(); // redraw to make the highlighting changes take effect on the screen
            }
        };

        // Listen for mouse moves and highlight the placemarks that the cursor rolls over.
        wwd.addEventListener("mousemove", handlePick);

        // Listen for taps on mobile devices and highlight the placemarks that the user taps.
        var tapRecognizer = new WorldWind.TapRecognizer(wwd, handlePick);

    });