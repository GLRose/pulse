import { Log, assert } from "./Utils";
import Collections from "./Collection";
import Request from "./Request";
class Pulse {
  constructor({
    collections = {},
    data = {},
    groups = [],
    indexes = [],
    actions = {},
    filters = {},
    routes = {},
    request = {}
  }) {
    // internal state
    this._collections = Object.create(null);
    this._subscribers = [];
    this._eventBus = this.activateEventBus();
    // collections.root = { data, indexes, actions, mutations, filters, routes };
    this.request = new Request(request);
    // filter dependency tracker
    this._global = {
      record: false,
      dependenciesFound: [],
      dependencyGraph: {},
      generatedFilters: [],
      allFilters: [],
      regenQueue: [],
      eventBus: this._eventBus,
      initComplete: false,
      request: this.request,
      collectionNamespace: [],
      history: [],
      errors: [],
      dataRef: {}
    };

    // init collections
    if (collections) this.initCollections(collections);

    // build a tree of data after collection constructor is finished
    this.buildGlobalDataRefrenceTree();

    // build a dependency graph for smart caching
    this.prepareDependencyGraph();

    // run and analyse the filters to populate the dependecy graph
    this.executeAllFilters();

    // loop through the regen queue to regenerate filters that couldn't execute first time around
    this.processRegenQueue();

    // declare Pulse has finished initialzing
    this._global.initComplete = true;
    Log("INIT_COMPLETE");
  }

  // subscribe a component to changes from pulse
  subscribe(context) {
    this._subscribers.push(context);
  }

  // use a proxy to pass messages around pulse that couldn't otherwise be done due to scoping
  activateEventBus() {
    return new Proxy(
      { message: null },
      {
        set: (target, key, value) => {
          if (value === "processRegenQueue") {
            this.processRegenQueue();
          }
          target[key] = value;
          return true;
        }
      }
    );
  }

  // prepare the dependecy graph
  prepareDependencyGraph() {
    let graph = this._global.dependencyGraph;
    let collections = this._global.collectionNamespace;

    for (let collection of collections) {
      graph[collection] = {};
      let _public = this._collections[collection]._public;
      let loop = [];

      let propertiesToRegister = ["filters", "groups", "data"];

      for (let i of propertiesToRegister) {
        Object.keys(_public[i]).forEach(name => loop.push(name));
      }
      for (let item of loop) {
        graph[collection][item] = {
          dependencies: [],
          dependents: [],
          dependencyNames: [],
          dependentNames: []
        };
      }
    }
  }

  // build the collection classes
  initCollections(collections) {
    let loop = Object.keys(collections);
    for (let index of loop) {
      this._collections[index] = new Collections(
        {
          name: index,
          subscribers: this._subscribers,
          updateSubscribers: this.updateSubscribers,
          global: this._global
        },
        collections[index]
      );
      // check if the instance has a naming conflict
      if (this[index]) {
        assert(
          `Collection name conflict, instance already has "${index}" thus it will not be accessable on the root state tree.`
        );
      } else if (index !== "root") {
        // bind the collection class to the root state tree
        this[index] = this._collections[index];
      }
      this._global.collectionNamespace.push(index);
    }
  }

  // this is passed into filters, actions and routes so they can access all data within Pulse
  buildGlobalDataRefrenceTree() {
    if (this._collections) {
      let loop = Object.keys(this._collections);
      for (let collection of loop) {
        this._global.dataRef[collection] = this._collections[
          collection
        ]._public;
      }
    }
  }

  executeAllFilters() {
    let loop = Object.keys(this._collections);
    for (let collection of loop) {
      this._collections[collection].analyseFilters();
    }
  }

  processRegenQueue() {
    let lastRegenerated = "";

    // if we called this function from the collection class
    if (this._global.regenQueue.length === 0) return;

    Log(
      `Regen queue processing. There are ${
        this._global.regenQueue.length
      } in the queue.`
    );
    // for dev purposes, prevent infinate loop
    for (let item of this._global.regenQueue) {
      // this removes the first item of the array and saves it to `entry`
      const entry = this._global.regenQueue.shift();
      const concatEntryName = `${entry.collection}/${entry.property}`;

      if (concatEntryName === lastRegenerated) {
        Log(`Prevented infinate loop for ${concatEntryName}`);
        return;
      }

      this._collections[entry.collection].executeAndAnalyseFilter(
        entry.property
      );

      lastRegenerated = concatEntryName;

      Log(
        `There are ${
          this._global.regenQueue.length
        } properties left to regenerate.`
      );
    }
    // loop!

    if (this._global.regenQueue.length > 0) this.processRegenQueue();
    // if we don't clear the generated filters, the filter analysis will fail next time around, causing an infinate loop! das bad
    else this._global.generatedFilters = new Array();
  }

  // Bind collection functions to root
  collect(data, index) {
    this._collections.root.collect(data, index);
  }

  // Anytime we detect a change, this function will push the updates to the subscribed components for both Vue and React
  updateSubscribers(key, value) {
    this._subscribers.map(component => {
      if (component._isVue) {
        if (component.hasOwnProperty(key)) {
          component.$set(component, key, value);
        }
      } else {
        self.processCallbacks(this.state);
      }
    });
  }

  // react native
  processCallbacks(data) {
    if (!self._subscribers.length) return false;
    this._subscribers.forEach(callback => callback(data));
    return true;
  }

  /** you can pass any context in the first argument here */
  commit(name, val) {
    Log(`[COMMIT] ${name}`);
    this._global.history.push({
      oldState: { ...this.state }
    });
    this.mutations[name](
      {
        self: this
      },
      val
    );
  }
}

export default Pulse;