import debounce from 'debounce-promise'
import { Feature } from 'ol'
import ObjectEventType from 'ol/ObjectEventType'
import { race as raceObs } from 'rxjs'
import { filter as filterObs, mapTo, skipWhile } from 'rxjs/operators'
import {
  EPSG_3857,
  getFeatureId,
  getFeatureProperties,
  initializeFeature,
  setFeatureId,
  setFeatureProperties,
} from '../ol-ext'
import { fromOlEvent as obsFromOlEvent, fromVueEvent as obsFromVueEvent } from '../rx-ext'
import {
  assert,
  clonePlainObject,
  hasProp,
  isEqual,
  mergeDescriptors,
  pick,
  stubObject,
  stubTrue,
  waitFor,
} from '../utils'
import geometryContainer from './geometry-container'
import olCmp, { CanceledError, FRAME_TIME, isCreateError, isMountError, OlObjectEvent } from './ol-cmp'
import projTransforms from './proj-transforms'
import stubVNode from './stub-vnode'
import styleContainer from './style-container'
import waitForMap from './wait-for-map'

/**
 * A vector object for geographic features with a geometry and other attribute properties,
 * similar to the features in vector file formats like **GeoJSON**.
 */
export default {
  mixins: [
    stubVNode,
    projTransforms,
    geometryContainer,
    styleContainer,
    olCmp,
    waitForMap,
  ],
  stubVNode: {
    empty: false,
    attrs () {
      return {
        id: this.vmId,
        class: this.vmClass,
      }
    },
  },
  props: {
    properties: {
      type: Object,
      default: stubObject,
    },
  },
  data () {
    return {
      viewProjection: EPSG_3857,
      dataProjection: EPSG_3857,
    }
  },
  computed: {
    currentProperties () {
      if (this.rev && this.$feature) {
        return this.getPropertiesInternal()
      }

      return this.properties
    },
    currentGeometryName () {
      if (!(this.rev && this.$feature)) return

      return this.getGeometryNameInternal()
    },
  },
  watch: {
    properties: {
      deep: true,
      async handler (value) {
        await this.setProperties(value)
      },
    },
    currentProperties: {
      deep: true,
      handler: /*#__PURE__*/debounce(function (value) {
        if (isEqual(value, this.properties)) return

        this.$emit('update:properties', clonePlainObject(value))
      }, FRAME_TIME),
    },
    currentGeometryName: /*#__PURE__*/debounce(function (value, prev) {
      if (value === prev) return

      this.$emit('update:geometryName', value)
    }, FRAME_TIME),
  },
  created () {
    this::defineServices()
  },
  methods: {
    /**
     * Create feature without inner style applying, feature level style
     * will be applied in the layer level style function.
     * @return {module:ol/Feature~Feature}
     * @protected
     */
    createOlObject () {
      const feature = initializeFeature(this.createFeature(), this.currentId)
      feature.setGeometry(this.$geometry)

      return feature
    },
    /**
     * @returns {Feature}
     */
    createFeature () {
      return new Feature(this.properties)
    },
    /**
     * @return {Promise<void>}
     * @protected
     */
    async beforeMount () {
      try {
        await waitFor(
          () => this.$geometryVm != null,
          raceObs(
            this.$olObjectEvents.pipe(
              filterObs(({ name, args }) => {
                return name === OlObjectEvent.ERROR &&
                  args[0] instanceof CanceledError
              }),
            ),
            obsFromVueEvent(this.$eventBus, ObjectEventType.ERROR).pipe(
              filterObs(([err, vm]) => {
                return (isCreateError(err) || isMountError(err)) &&
                  hasProp(vm, '$geometry') &&
                  vm.$vq?.closest(this)
              }),
            ),
          ).pipe(
            mapTo(stubTrue()),
          ),
        )

        return this::olCmp.methods.beforeMount()
      } catch (err) {
        err.message = `${this.vmName} wait for $geometry failed: ${err.message}`
        throw err
      }
    },
    /**
     * @return {Promise<void>}
     * @protected
     */
    async mount () {
      if (this.$featuresContainer) {
        await this.$featuresContainer.addFeature(this)
      }

      return this::olCmp.methods.mount()
    },
    /**
     * @return {Promise<void>}
     * @protected
     */
    async unmount () {
      if (this.$featuresContainer) {
        await this.$featuresContainer.removeFeature(this)
      }

      return this::olCmp.methods.unmount()
    },
    /**
     * @return {void}
     * @protected
     */
    subscribeAll () {
      this::olCmp.methods.subscribeAll()
      this::subscribeToEvents()
    },
    /**
     * @return {Object}
     * @protected
     */
    getServices () {
      const vm = this

      return mergeDescriptors(
        this::olCmp.methods.getServices(),
        this::geometryContainer.methods.getServices(),
        this::styleContainer.methods.getServices(),
        {
          get featureVm () { return vm },
        },
      )
    },
    .../*#__PURE__*/pick(olCmp.methods, [
      'refresh',
      'scheduleRefresh',
      'remount',
      'scheduleRemount',
      'recreate',
      'scheduleRecreate',
      'resolveOlObject',
    ]),
    .../*#__PURE__*/pick(waitForMap.methods, [
      'beforeInit',
    ]),
    .../*#__PURE__*/pick(geometryContainer.methods, [
      'setGeometry',
    ]),
    .../*#__PURE__*/pick(styleContainer.methods, [
      'setStyle',
    ]),
    resolveFeature: olCmp.methods.resolveOlObject,
    getGeometryTarget: olCmp.methods.resolveOlObject,
    getStyleTarget: olCmp.methods.resolveOlObject,
    /**
     * @return {string|number}
     */
    getIdInternal () {
      return getFeatureId(this.$feature)
    },
    /**
     * @param {string|number} id
     * @return {void}
     */
    setIdInternal (id) {
      assert(id != null && id !== '', 'Invalid feature id')

      if (id === this.getIdInternal()) return

      setFeatureId(this.$feature, id)
    },
    /**
     * @return {Promise<string>}
     */
    async getGeometryName () {
      await this.resolveFeature()

      return this.getGeometryNameInternal()
    },
    /**
     * @return {string}
     * @protected
     */
    getGeometryNameInternal () {
      return this.$feature.getGeometryName()
    },
    /**
     * @param {string} geometryName
     * @return {Promise<void>}
     */
    async setGeometryName (geometryName) {
      if (geometryName === await this.getGeometryName()) return

      (await this.resolveFeature()).setGeometryName(geometryName)
    },
    /**
     * @return {Promise<Object>}
     */
    async getProperties () {
      await this.resolveFeature()

      return this.getPropertiesInternal()
    },
    getPropertiesInternal () {
      return getFeatureProperties(this.$feature)
    },
    /**
     * @param {Object} properties
     * @return {Promise<void>}
     */
    async setProperties (properties) {
      properties = getFeatureProperties({ properties })
      if (isEqual(properties, await this.getProperties())) return

      setFeatureProperties(await this.resolveFeature(), properties)
    },
    /**
     * Checks if feature lies at `pixel`.
     * @param {number[]} pixel
     * @return {Promise<boolean>}
     */
    async isAtPixel (pixel) {
      const selfFeature = await this.resolveFeature()
      let layerFilter
      if (this.$layerVm) {
        const selfLayer = await this.$layerVm.resolveLayer()
        layerFilter = layer => layer === selfLayer
      }

      return this.$mapVm.forEachFeatureAtPixel(pixel, feature => feature === selfFeature, { layerFilter })
    },
  },
}

function defineServices () {
  Object.defineProperties(this, {
    $feature: {
      enumerable: true,
      get: () => this.$olObject,
    },
    $layerVm: {
      enumerable: true,
      get: () => this.$services?.layerVm,
    },
    $mapVm: {
      enumerable: true,
      get: () => this.$services?.mapVm,
    },
    $featuresContainer: {
      enumerable: true,
      get: () => this.$services?.featuresContainer,
    },
  })
}

async function subscribeToEvents () {
  const propChanges = obsFromOlEvent(
    this.$feature,
    ObjectEventType.PROPERTYCHANGE,
    ({ key }) => {
      switch (key) {
        case this.$feature.getGeometryName():
          return {
            prop: 'geometry',
            value: this.writeGeometryInDataProj(this.getGeometry()),
            compareWith: this.currentGeometryDataProj,
          }
        default:
          return {
            prop: 'properties',
            value: {
              ...this.properties,
              [key]: this.$feature.get(key),
            },
            compareWith: this.currentProperties,
          }
      }
    },
  ).pipe(
    skipWhile(({ value, compareWith }) => isEqual(value, compareWith)),
  )
  this.subscribeTo(propChanges, () => {
    ++this.rev
  })
}
