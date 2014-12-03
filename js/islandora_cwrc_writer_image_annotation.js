/*jshint browser: true*/
/*global jQuery, Drupal, setupLayoutAndModules, CwrcApi:true*/
/**
 * CWRC-Writer global callback used to configure the CWRC-Writer.
 *
 * This overwrites the existing cwrcWriterInit callback so that it can properly
 * set up the Image Annotation portion of the viewer as well.
 *
 * @see https://github.com/cwrc/CWRC-Writer for more information.
 *
 * @param {jQuery} $
 * @param Writer
 * @param Delegator
 */
function cwrcWriterInit($, Writer, Delegator) {
  'use strict';
  var writer, config;
  // Replace the CwrcAPI with our own constructor which can handle how we
  // deal with entities.
  CwrcApi = Drupal.CWRCWriter.api.CwrcApi;

  config = Drupal.settings.CWRCWriter;
  config.id = 'editor';
  config.delegator = Delegator;
  writer = new Writer(config);
  // We have to replace the baseUrl after object construction since it is
  // hard-coded.
  writer.baseUrl = config.baseUrl;
  // Hold onto a reference for safe keeping.
  Drupal.CWRCWriter.writer = writer;

  writer.event('writerInitialized').subscribe(function (writer) {
    // When we change the schema we should update the document.
    writer.event('schemaChanged').subscribe(function (schemaId) {
      $.ajax({
        url: writer.baseUrl + 'editor/documents/' + writer.currentDocId +'/schema',
        type: 'POST',
        data: writer.schemaManager.schemas[schemaId],
        error: function() {
          writer.dialogManager.show('message', {
            title: 'Error',
            msg: 'An error occurred while trying to change the documents default schema.',
            type: 'error'
          });
        }
      });
    });
    // load modules then do the setup
    require(['jquery', 'modules/entitiesList', 'modules/relations',
        'modules/selection', 'modules/structureTree', 'modules/validation'],
      function ($, EntitiesList, Relations, Selection, StructureTree, Validation) {
        var $textImageLinkButton = $('#editor_addTextImageLink');
        // The function setupLayoutAndModules() is provided by layout.js, this
        // function assumes it was already loaded before it's called.
        setupLayoutAndModules(writer, EntitiesList, Relations, Selection, StructureTree, Validation);
        // Since we added a tab for Image Annotations we have to reset the minSize
        // of that panel.
        writer.layout.west.options.minSize = 360;
        writer.layout.west.options.resizable = true;
        writer.layout.center.options.minSize = 580;
        // Replace the show loader with our own function which can handle how we
        // load documents, such that it will be drupal aware.
        writer.dialogManager.filemanager.showLoader = Drupal.CWRCWriter.dialogManager.filemanager.showLoader($, writer);
        // Replace the CwrcAPI with our own constructor which can handle how we
        // deal with entities.
        CwrcApi = Drupal.CWRCWriter.api.CwrcApi;
        // Log all loaded documents.
        writer.event('documentLoaded').subscribe(function () {
          // Update the select field with the new value if possible.
          var $select = $('#islandora-cwrc-document-select'),
            $navigation = $('#islandora-cwrc-document-nav'),
            index,
            source;
          $select.val(Drupal.CWRCWriter.writer.currentDocId);
          $('li a', $navigation).removeClass('disabled');
          if ($('option:selected', $select).is('option:last-child')) {
            $('li.next a', $navigation).addClass('disabled');
          }
          if ($('option:selected', $select).is('option:first-child')) {
            $('li.prev a', $navigation).addClass('disabled');
          }
          // Force resize, as it's needed when the layout is done in an iframe as
          // it expects.
          setTimeout(writer.layout.resizeAll, 500);
          // Recreate the image annotation block to show the new source object.
          index = $.inArray(Drupal.CWRCWriter.writer.currentDocId, Drupal.settings.islandoraCWRCWriterImageAnnotation.documents);
          source = Drupal.settings.islandoraCWRCWriterImageAnnotation.sources[index];
          // Did we already load this source? If not lets load it again.
          if (source !== Drupal.settings.islandoraImageAnnotation.pid) {
            $.ajax({
              type: 'GET',
              async: false,
              url: Drupal.settings.basePath + 'islandora/object/' + source + '/annotation/settings',
              success: function (data) {
                // Use the latest data, we can't just cache everything as new
                // annotations are added as time goes on.
                $.extend(Drupal.settings.islandoraCWRCWriterImageAnnotation[source], data);
                // Reattach Widget behaviors for the new pages.
                Drupal.detachBehaviors(document);
                Drupal.attachBehaviors(document, Drupal.settings);
              }
            });
          }
        });
        if (config.documents.length) {
          window.location.hash = (window.location.hash !== '') ? window.location.hash : config.documents[0];
        }
        if (window.location.hash) {
          writer.fileManager.loadInitialDocument(window.location.hash);
        }
        // Resize the shared canvas layout when it's pane changes size.
        writer.layout.east.options.onresize = function (pane, $pane, paneState, paneOptions) {
          Drupal.IslandoraImageAnnotationCanvas.getInstance().resizeCanvasContainer();
        };
        // Unfortunately TinyMCE does not support dynamically loading plugins or
        // adding buttons, for TinyMCE all configuration must be done when it's
        // initialized
        // (@see http://www.tinymce.com/wiki.php/API3:method.tinymce.init)
        // Also the CWRCWriter does not expose the configuration options of
        // TinyMCE for us (@see CWRCWriter/js/writer.js). At a later time we can
        // refactor the CWRCWriter to allow us to configure TinyMCE but for now
        // we'll have to settle for hacking in our custom behavior.
        $('#editor_toolbar1')
          .find('tr td:first')
          .after($('<td />', { style: 'position: relative;' }).append($textImageLinkButton));
        $textImageLinkButton.show();
        // Show the annotation when the user clicks on the text to image link.
        writer.event('entityFocused').subscribe(function (entityId) {
          var entity_type, uuid;
          if (writer.entities[entityId] !== undefined) {
            entity_type = writer.entities[entityId].props.type;
            if (entity_type === 'textimagelink') {
              uuid = writer.entities[entityId].info.attributes.id;
              Drupal.IslandoraImageAnnotationList.getInstance().showAnnotation(uuid);
            }
          }
        });
        // Show the annotation when the user clicks away from the image link.
        writer.event('entityUnfocused').subscribe(function (entityId) {
          var entity_type, uuid;
          if (writer.entities[entityId] !== undefined && entityId !== undefined) {
            if (writer.entities[entityId].props.type !== undefined) {
              entity_type = writer.entities[entityId].props.type;
              if (entity_type === 'textimagelink') {
                uuid = writer.entities[entityId].info.attributes.id;
                Drupal.IslandoraImageAnnotationList.getInstance().hideAnnotation(uuid);
              }
            }
          }
        });
        $textImageLinkButton.click(function () {
          var result, query, data;
          result = writer.utilities.isSelectionValid();
          if (result === writer.VALID) {
            writer.editor.currentBookmark = writer.editor.selection.getBookmark(1);
            // 'query' represents the selected text.
            query = writer.editor.currentBookmark.rng.toString();
            // Create the dialog, and show it.
            data = {
              writer: writer,
              query: query,
              title: writer.entitiesModel.getTitle('person'),
              pos: writer.editor.contextMenuPos
            };
            Drupal.IslandoraImageAnnotationDialog['#islandora-cwrc-writer-text-image-link-dialog'].show(data);
          } else if (result === writer.NO_SELECTION) {
            writer.dialogManager.show('message', {
              title: 'Error',
              msg: 'Please select some text before adding an entity or tag.',
              type: 'error'
            });
          } else if (result === writer.NO_COMMON_PARENT) {
            writer.dialogManager.show('message', {
              title: 'Error',
              msg: 'Please ensure that the beginning and end of your selection have a common parent.<br/>For example, your selection cannot begin in one paragraph and end in another, or begin in bolded text and end outside of that text.',
              type: 'error'
            });
          }
        });
      });
  });
}

