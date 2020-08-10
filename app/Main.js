/*
  Copyright 2020 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

define([
  "calcite",
  "dojo/_base/declare",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/ApplicationBase",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/Graphic",
  "esri/Map",
  "esri/views/SceneView",
  "esri/geometry/Mesh",
  "esri/layers/GraphicsLayer",
  "esri/portal/Portal",
  "esri/widgets/Home",
  "esri/widgets/Expand"
], function(calcite, declare, i18n,
            ApplicationBase, itemUtils, domHelper, domConstruct,
            IdentityManager, Evented, watchUtils, promiseUtils,
            Graphic, EsriMap, SceneView, Mesh, GraphicsLayer, Portal,
            Home, Expand){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems);
      const firstItem = (validItems && validItems.length) ? validItems[0].value : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-container";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(this.base.config, firstItem, view).then(() => {
              view.container.classList.remove("loading");
            });
          });
        });
      });
    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function(config, item, view){

      // TITLE //
      document.getElementById("app-title-node").innerHTML = config.title;

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        updating_node.classList.toggle("is-active", updating);
      });

      // USER SIGN IN //
      return this.initializeUserSignIn().catch(console.warn).then(() => {

        // STARTUP DIALOG //
        this.initializeStartupDialog();

        // POPUP DOCKING OPTIONS //
        view.popup.dockEnabled = true;
        view.popup.dockOptions = { position: "top-center" };

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 0 });

        // SLIDES //
        //this.initializeSceneSlides(view)

        // APPLICATION READY //
        this.applicationReady(view);

      });

    },

    /**
     *
     */
    initializeStartupDialog: function(){

      // APP ID //
      const appID = `show-startup-${location.pathname.split('/')[2]}`;

      // STARTUP DIALOG //
      const showStartup = localStorage.getItem(appID) || 'show';
      if(showStartup === 'show'){
        calcite.bus.emit('modal:open', { id: 'app-details-dialog' });
      }

      // HIDE STARTUP DIALOG //
      const hideStartupInput = document.getElementById('hide-startup-input');
      hideStartupInput.checked = (showStartup === 'hide');
      hideStartupInput.addEventListener('change', () => {
        localStorage.setItem(appID, hideStartupInput.checked ? 'hide' : 'show');
      });

    },

    /**
     *
     * @param view
     */
    initializeSceneSlides: function(view){

      if(view.map.presentation && view.map.presentation.slides && (view.map.presentation.slides.length > 0)){

        const slidesContainer = domConstruct.create("div", { className: 'slides-container animate-in-up' });
        view.ui.add(slidesContainer, { index: 0 });

        const slideLabel = domConstruct.create("div", { className: "slide-label icon-ui-up icon-ui-flush text-center font-size-1", title: 'toggle slides' }, slidesContainer);
        slideLabel.addEventListener('click', () => {
          slidesContainer.classList.toggle('animate-in-up');
          slidesContainer.classList.toggle('animate-out-up');
          slideLabel.classList.toggle('icon-ui-up');
          slideLabel.classList.toggle('icon-ui-down');
        });

        const slides = view.map.presentation.slides;
        slides.forEach(slide => {

          const slideBtn = domConstruct.create("button", { className: "slide-btn tooltip tooltip-top", 'aria-label': slide.title.text }, slidesContainer);
          domConstruct.create("img", { className: "slide-btn-thumb", src: slide.thumbnail.url }, slideBtn);

          slideBtn.addEventListener("click", clickEvt => {
            clickEvt.stopPropagation();
            //slide.applyTo(view);
            view.goTo({ target: slide.viewpoint }).then(() => { view.focus(); });
          });

        });

        /*view.on('layerview-create', (evt) => {
          slides.forEach(slide => {
            if(!slide.visibleLayers.find(l => l.id === evt.layer.id)){
              slide.visibleLayers.push(evt.layer);
            }
          });
        });*/

      }

    },


    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function(){

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn).catch(userSignOut).then();
      };
      IdentityManager.on("credential-create", checkSignInStatus);

      // SIGN IN NODE //
      const signInNode = document.getElementById("sign-in-node");
      const userNode = document.getElementById("user-node");

      // UPDATE UI //
      const updateSignInUI = () => {
        if(this.base.portal.user){
          document.getElementById("user-firstname-node").innerHTML = this.base.portal.user.fullName.split(" ")[0];
          document.getElementById("user-fullname-node").innerHTML = this.base.portal.user.fullName;
          document.getElementById("username-node").innerHTML = this.base.portal.user.username;
          document.getElementById("user-thumb-node").src = this.base.portal.user.thumbnailUrl;
          signInNode.classList.add('hide');
          userNode.classList.remove('hide');
        } else {
          signInNode.classList.remove('hide');
          userNode.classList.add('hide');
        }
        return promiseUtils.resolve();
      };

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({ url: this.base.config.portalUrl, authMode: "immediate" });
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).catch(console.warn).then();
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        return this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).catch(console.warn).then();

      };

      // USER SIGN IN //
      signInNode.addEventListener("click", userSignIn);

      // SIGN OUT NODE //
      const signOutNode = document.getElementById("sign-out-node");
      if(signOutNode){
        signOutNode.addEventListener("click", userSignOut);
      }

      return checkSignInStatus();
    },


    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function(view){

      this.initializeSpherePanel(view);

      const photosLayer = view.map.layers.find(layer => { return (layer.title === "Lifeline View"); });
      photosLayer.load().then(() => {
        photosLayer.outFields = ["*"];

        const { addFeatureToList, selectFeatureInList } = this.initializeFeatureList(view, photosLayer);

        const photoFeatureQuery = photosLayer.createQuery();
        photosLayer.queryFeatures(photoFeatureQuery).then(photoFeatureFS => {
          photoFeatureFS.features.forEach(addFeatureToList);
        });

        view.popup.watch("selectedFeature", selectedFeature => {
          if(selectedFeature){ selectFeatureInList(selectedFeature); }
        });

      });

    },

    /**
     *
     * @param view
     * @param photosLayer
     * @returns {{addFeatureToList: addFeatureToList, selectFeatureInList: selectFeatureInList}}
     */
    initializeFeatureList: function(view, photosLayer){

      const sideContainer = document.getElementById('side-container');
      const photoContainer = document.getElementById('photo-container');
      const collapsedPhotoContainer = (collapsed) => {
        photoContainer.classList.toggle('collapsed', collapsed);
        sideContainer.classList.toggle('column-8', !collapsed);
      };

      const collapseNode = document.getElementById('collapse-node');
      collapseNode.addEventListener('click', () => {
        collapsedPhotoContainer(!photoContainer.classList.contains('collapsed'));
      });

      const photoFeatureList = document.getElementById('photo-features-list');
      const photoCountLabel = document.getElementById('photo-features-count-label');

      const countFormatter = new Intl.NumberFormat('default', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      const dateFormatter = new Intl.DateTimeFormat('default', { year: 'numeric', month: 'long', day: 'numeric' });

      const objectIdField = photosLayer.objectIdField;

      /**
       *
       * @param photoFeature
       */
      const addFeatureToList = (photoFeature) => {

        const photoNode = domConstruct.create('div', {
          'data-oid': `oid-${photoFeature.attributes[objectIdField]}`,
          className: 'photo-feature-node side-nav-link'
        }, photoFeatureList);

        domConstruct.create('div', {
          className: 'font-size--1',
          innerHTML: photoFeature.attributes.Title
        }, photoNode);

        domConstruct.create('div', {
          className: 'font-size--3 avenir-italic text-right',
          innerHTML: dateFormatter.format(photoFeature.attributes.Date_Time)
        }, photoNode);

        photoNode.addEventListener('click', () => {
          selectFeatureInList(photoFeature);
        });

        photoCountLabel.innerHTML = countFormatter.format(photoFeatureList.querySelectorAll('.photo-feature-node').length);
      };

      /**
       *
       * @param photoFeature
       * @param node
       */
      const selectFeatureInList = (photoFeature, node) => {
        const oid = photoFeature.attributes[objectIdField];

        photoFeatureList.querySelectorAll('.photo-feature-node.selected').forEach(n => n.classList.remove('selected'));
        const photoNode = node || photoFeatureList.querySelector(`.photo-feature-node[data-oid="oid-${oid}"]`);
        if(photoNode){
          photoNode.classList.add('selected');
          photoNode.scrollIntoView(true);
        }

        collapsedPhotoContainer(false);

        document.getElementById("photo-list").innerHTML = "";

        view.goTo({ target: photoFeature, scale: 2500.0, tilt: 40.0 }).then(() => {
          photosLayer.queryAttachments({ objectIds: [oid] }).then(attachmentInfos => {
            this.displayAttachmentsList(photoFeature, attachmentInfos[oid]);
          });
        });

      }

      return { addFeatureToList, selectFeatureInList };
    },

    /**
     *
     * @param selectedFeature
     * @param attachmentInfos
     */
    displayAttachmentsList: function(selectedFeature, attachmentInfos){

      const photoCountLabel = document.getElementById("photo-count-label");
      photoCountLabel.innerHTML = attachmentInfos.length;

      const photosList = document.getElementById("photo-list");
      photosList.innerHTML = "";

      attachmentInfos.forEach(attachmentInfo => {
        if(this.contentIsImage(attachmentInfo.contentType)){

          const attachmentInfoNode = domConstruct.create("div", { className: "side-nav-link btn-disabled" }, photosList);

          domConstruct.create("div", { className: "photo-preview-name font-size-0", innerHTML: attachmentInfo.name }, attachmentInfoNode);

          const attachmentImg = domConstruct.create("img", {
            className: "photo-preview",
            src: attachmentInfo.url,
            crossOrigin: "anonymous"
          }, attachmentInfoNode);

          attachmentImg.onload = () => {
            attachmentInfoNode.classList.remove("btn-disabled");

            attachmentImg.addEventListener("click", () => {
              this.getFlippedImageCanvas(attachmentImg).then(canvas => {
                this.setSphereLocation(selectedFeature.geometry.clone(), canvas);
              });
            });
          };

        } else {
          console.warn("Non-image attachment: ", attachmentInfo.contentType, attachmentInfo);
        }
      });

    },

    /**
     *
     * @param contentType
     * @returns {boolean}
     */
    contentIsImage: function(contentType){
      const content_info = contentType.split("/");
      const type = content_info[0];
      const subtype = content_info[(content_info.length > 1) ? 1 : 0];
      return ((type === "image") || (["gif", "jpeg", "jpg", "png", "svg+xml"].includes(subtype)));
    },

    /**
     *
     * @param image
     */
    getFlippedImageCanvas: function(image){
      return promiseUtils.create((resolve, reject) => {

        const canvas = domConstruct.create("canvas", {});
        const ctx = canvas.getContext('2d');

        const img = new Image();
        img.onload = () => {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          ctx.scale(-1, 1);
          ctx.drawImage(img, -img.naturalWidth, 0, img.naturalWidth, img.naturalHeight);

          resolve(canvas);
        };
        img.crossOrigin = image.crossOrigin;
        img.src = image.src;

      });
    },

    /**
     *
     * @param view
     * @returns {*}
     */
    initializeSpherePanel: function(view){

      // SPHERE CONTAINER //
      const sphereContainer = document.getElementById("sphere-container");

      // SPHERE GRAPHIC //
      const sphereGraphic = new Graphic({});
      const sphereGraphicsLayer = new GraphicsLayer({ graphics: [sphereGraphic] });

      // SPHERE VIEW //
      const sphereView = new SceneView({
        container: sphereContainer,
        map: new EsriMap({
          ground: 'world-elevation',
          basemap: 'satellite',
          layers: [sphereGraphicsLayer]
        }),
        ui: { components: [] }
      });
      return sphereView.when(() => {
        sphereView.container.classList.add("hide");

        this.displaySphereView = () => {
          view.container.classList.add("hide");
          sphereView.container.classList.remove("hide");
        };

        this.hideSphereView = () => {
          sphereView.container.classList.add("hide");
          view.container.classList.remove("hide");
        };

        // BACK TO TOP //
        const backBtn = domConstruct.create("div", {
          id: "close-view-btn",
          className: "icon-ui-close icon-ui-flush font-size-5 esri-widget--button",
          title: "Back to Map"
        });
        sphereView.ui.add(backBtn, "top-right");
        backBtn.addEventListener("click", () => { this.hideSphereView(); });

        // VIEW CAMERA HEADING //
        this.createHeadingSlider(sphereView);

        // CAMERA POSITION NAVIGATION //
        this.setCameraPositionNavigation(sphereView);

        // INTERNAL SPHERE NAVIGATION FROM LONDON SPHERES //
        //this.initSphereInternalNavigation(sphereView);

        // SPHERE SIZE //
        const sphere_size_meters = 1500.0;

        /**
         * SET SPHERE LOCATION
         *
         * @param location
         * @param image
         */
        this.setSphereLocation = (location, image) => {

          sphereGraphic.set({
            geometry: Mesh.createSphere(location.clone(), {
              size: sphere_size_meters,
              densificationFactor: 2,
              material: { colorTexture: image }
            }),
            symbol: {
              type: "mesh-3d",
              symbolLayers: [{ type: "fill" }]
            }
          });

          location.z = (sphere_size_meters * 0.5);

          sphereView.goTo({ position: location, heading: 0.0, tilt: 90.0 }, { animate: false }).then(() => {
            sphereView.focus();
            this.displaySphereView();
          });
        };

        return sphereView;
      });

    },

    /**
     *
     * @param sceneView
     */
    createHeadingSlider: function(sceneView){

      this.setCameraHeading = (heading, animate) => {
        const camera = sceneView.camera.clone();
        camera.heading = heading;
        sceneView.goTo(camera, { animate: false });
      };

      const headingPanel = domConstruct.create("div", { className: "panel panel-white padding-trailer-quarter" });
      sceneView.ui.add(headingPanel, "top-left");

      const directionsTable = domConstruct.create("table", { className: "slider-table trailer-0" }, headingPanel);
      const directionsRow = domConstruct.create("tr", {}, directionsTable);
      domConstruct.create("td", {}, directionsRow);
      const directionsNode = domConstruct.create("div", { className: "directions-node text-center" }, domConstruct.create("td", {}, directionsRow));
      domConstruct.create("td", {}, directionsRow);

      const directions = [
        { label: "N", tooltip: "North", heading: 0.0 },
        { label: "ne", tooltip: "North East", heading: 45.0 },
        { label: "E", tooltip: "East", heading: 90.0 },
        { label: "se", tooltip: "South East", heading: 135.0 },
        { label: "S", tooltip: "South", heading: 180.0 },
        { label: "sw", tooltip: "South West", heading: 225.0 },
        { label: "W", tooltip: "West", heading: 270.0 },
        { label: "nw", tooltip: "North West", heading: 315.0 },
        { label: "N", tooltip: "North", heading: 360.0 }
      ];
      directions.forEach(dirInfo => {
        const dirNode = domConstruct.create("span", {
          className: "direction-node inline-block text-center font-size--3 avenir-demi esri-interactive",
          innerHTML: dirInfo.label,
          title: dirInfo.tooltip
        }, directionsNode);
        dirNode.addEventListener("click", () => {
          this.setCameraHeading(dirInfo.heading);
        });
      });

      const sliderRow = domConstruct.create("tr", {}, directionsTable);
      const sliderLeftNode = domConstruct.create("span", {
        title: "decrease/left/counter-clockwise",
        className: "direction-node esri-interactive icon-ui-left icon-ui-flush font-size-1"
      }, domConstruct.create("td", {}, sliderRow));
      const slider = domConstruct.create("input", {
        className: "font-size-1",
        type: "range",
        min: 0, max: 360, step: 1, value: 0
      }, domConstruct.create("td", {}, sliderRow));
      const sliderRightNode = domConstruct.create("span", {
        title: "increase/right/clockwise",
        className: "direction-node esri-interactive icon-ui-right icon-ui-flush font-size-1"
      }, domConstruct.create("td", {}, sliderRow));

      sliderLeftNode.addEventListener("click", () => {
        this.setCameraHeading(slider.valueAsNumber - 5);
      });
      sliderRightNode.addEventListener("click", () => {
        this.setCameraHeading(slider.valueAsNumber + 5);
      });

      const headingRow = domConstruct.create("tr", {}, directionsTable);
      domConstruct.create("td", {}, headingRow);
      const heading_label = domConstruct.create("div", { className: "direction-label text-center font-size-1 avenir-bold", innerHTML: "0&deg;" }, domConstruct.create("td", {}, headingRow));
      domConstruct.create("td", {}, headingRow);

      slider.addEventListener("input", () => {
        this.setCameraHeading(slider.valueAsNumber);
      });
      watchUtils.init(sceneView, "camera.heading", (heading) => {
        heading_label.innerHTML = `${heading.toFixed(0)}&deg;`;
        slider.valueAsNumber = heading;
      });

    },

    /**
     *
     * @param view
     */
    setCameraPositionNavigation: function(view){

      // STOP EVENT PROPAGATION //
      const stopEventPropagation = (evt) => {evt.stopPropagation();}

      //
      // B + Left-click + Drag //
      //
      view.on("immediate-click", stopEventPropagation);
      view.on("click", stopEventPropagation);
      view.on("double-click", stopEventPropagation);
      // DRAG //
      view.inputManager._inputManager._activeKeyModifiers = new Set(["b"]);
      view.on("drag", ["b"], function(evt){
        // LEFT CLICK //
        if(evt.button !== 0){
          evt.stopPropagation();
        }
      });
      view.on("hold", stopEventPropagation);
      view.on("key-down", stopEventPropagation);
      view.on("key-up", stopEventPropagation);
      //view.on("mouse-wheel", stopEventPropagation);
      view.on("pointer-down", stopEventPropagation);
      view.on("pointer-up", stopEventPropagation);

      view.on("pointer-enter", function(evt){
        view.container.style.cursor = "all-scroll";
        evt.stopPropagation();
      });
      view.on("pointer-leave", function(evt){
        view.container.style.cursor = "default";
        evt.stopPropagation();
      });
      view.on("pointer-move", stopEventPropagation);

    },

    /**
     *
     * @param view
     */
    initSphereInternalNavigation: function(view){

      let enabled = false;

      let deltaX = null;
      let deltaY = null;
      const updateView = function(){
        if(deltaX != null && deltaY != null){
          view.goTo({
            position: view.camera.position,
            heading: Math.min(Math.max(-360.0, view.camera.heading + deltaX), 360.0),
            tilt: Math.min(Math.max(0.0, view.camera.tilt + deltaY), 180.0)
          }, { animate: false, duration: 90 });
        }
        if(enabled){
          requestAnimationFrame(updateView);
        }
      };

      const moveDelta = 7;
      const centerX = (view.width * 0.5);
      const centerY = (view.height * 0.5);
      view.on("pointer-move", (evt) => {
        if(enabled){
          deltaX = ((centerX - evt.x) / view.width) * -moveDelta;
          deltaY = ((centerY - evt.y) / view.height) * moveDelta;
        }
      });

      view.on("pointer-enter", (evt) => {
        enabled = true;
        requestAnimationFrame(updateView);
      });

      view.on("pointer-leave", (evt) => {
        enabled = false;
        deltaX = null;
        deltaY = null;
      });

    }

  });
});
