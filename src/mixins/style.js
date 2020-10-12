import { EPSG_3857, getStyleId, initializeStyle, setStyleId } from '../ol-ext'
import { assert, mergeDescriptors, pick } from '../utils'
import olCmp from './ol-cmp'
import stubVNode from './stub-vnode'
import waitForMap from './wait-for-map'

/**
 * Basic style mixin.
 */
export default {
  mixins: [
    stubVNode,
    olCmp,
    waitForMap,
  ],
  stubVNode: {
    empty () {
      return this.vmId
    },
  },
  data () {
    return {
      viewProjection: EPSG_3857,
      dataProjection: EPSG_3857,
    }
  },
  created () {
    this::defineServices()
  },
  methods: {
    /**
     * @return {OlStyle|Promise<OlStyle>}
     * @protected
     */
    async createOlObject () {
      return initializeStyle(await this.createStyle(), this.currentId)
    },
    /**
     * @return {OlStyle|Promise<OlStyle>}
     * @protected
     * @abstract
     */
    createStyle () {
      throw new Error(`${this.vmName} not implemented method: createStyle()`)
    },
    /**
     * @return {Promise<void>}
     */
    async remount () {
      await this.refresh()
      await this::olCmp.methods.remount()

      if (this.$mapVm) {
        await this.$mapVm.render()
      }
    },
    /**
     * @return {Object}
     * @protected
     */
    getServices () {
      const vm = this

      return mergeDescriptors(
        this::olCmp.methods.getServices(),
        {
          get styleVm () { return vm },
        },
      )
    },
    /**
     * @return {Promise<OlStyle>}
     */
    resolveStyle: olCmp.methods.resolveOlObject,
    .../*#__PURE__*/pick(olCmp.methods, [
      'init',
      'deinit',
      'beforeMount',
      'mount',
      'unmount',
      'refresh',
      'scheduleRefresh',
      'scheduleRemount',
      'recreate',
      'scheduleRecreate',
      'subscribeAll',
      'resolveOlObject',
    ]),
    .../*#__PURE__*/pick(waitForMap.methods, [
      'beforeInit',
    ]),
    /**
     * @returns {string|number}
     */
    getIdInternal () {
      return getStyleId(this.$style)
    },
    /**
     * @param {string|number} id
     * @returns {void}
     */
    setIdInternal (id) {
      assert(id != null && id !== '', 'Invalid style id')

      if (id === this.getIdInternal()) return

      setStyleId(this.$style, id)
    },
  },
}

function defineServices () {
  Object.defineProperties(this, {
    /**
     * @type {OlStyle|undefined}
     */
    $style: {
      enumerable: true,
      get: () => this.$olObject,
    },
    /**
     * @type {Object|undefined}
     */
    $mapVm: {
      enumerable: true,
      get: () => this.$services?.mapVm,
    },
    /**
     * @type {Object|undefined}
     */
    $viewVm: {
      enumerable: true,
      get: () => this.$services?.viewVm,
    },
    /**
     * @type {Object|undefined}
     */
    $styleContainer: {
      enumerable: true,
      get: () => this.$services?.styleContainer,
    },
  })
}
