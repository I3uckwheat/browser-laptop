/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const Immutable = require('immutable')
const appActions = require('../../../js/actions/appActions')
const debounce = require('../../../js/lib/debounce')
const historyState = require('../../common/state/historyState')
const aboutNewTabState = require('../../common/state/aboutNewTabState')
const bookmarkLocationCache = require('../../common/cache/bookmarkLocationCache')
const newTabData = require('../../../js/data/newTabData')
const {isSourceAboutUrl} = require('../../../js/lib/appUrlUtil')
const aboutNewTabMaxEntries = 100
let appStore

let minCountOfTopSites
let minAccessOfTopSites
const staticData = Immutable.fromJS(newTabData.topSites)

const isPinned = (state, siteKey) => {
  return aboutNewTabState.getPinnedTopSites(state).some(site => {
    if (!site || !site.get) {
      return false
    }
    return site.get('key') === siteKey
  })
}

const isIgnored = (state, siteKey) => {
  return aboutNewTabState.getIgnoredTopSites(state).includes(siteKey)
}

const sortCountDescending = (left, right) => {
  const leftCount = left.get('count', 0)
  const rightCount = right.get('count', 0)
  if (leftCount < rightCount) {
    return 1
  }
  if (leftCount > rightCount) {
    return -1
  }
  if (left.get('lastAccessedTime') < right.get('lastAccessedTime')) {
    return 1
  }
  if (left.get('lastAccessedTime') > right.get('lastAccessedTime')) {
    return -1
  }
  return 0
}

const removeDuplicateDomains = (list) => {
  const siteDomains = new Set()
  return list.filter((site) => {
    if (!site.get('location')) {
      return false
    }
    try {
      const hostname = require('../../common/urlParse')(site.get('location')).hostname
      if (!siteDomains.has(hostname)) {
        siteDomains.add(hostname)
        return true
      }
    } catch (e) {
      console.error('Error parsing hostname: ', e)
    }
    return false
  })
}

const calculateTopSites = (clearCache, withoutDebounce = false) => {
  if (clearCache) {
    clearTopSiteCacheData()
  }
  if (withoutDebounce) {
    getTopSiteData()
  } else {
    debouncedGetTopSiteData()
  }
}

const getTopSiteData = () => {
  if (!appStore) {
    appStore = require('../../../js/stores/appStore')
  }
  const state = appStore.getState()
  // remove folders; sort by visit count; enforce a max limit
  let sites = historyState.getSites(state)
    .filter((site, key) => !isSourceAboutUrl(site.get('location')) &&
      !isPinned(state, key) &&
      !isIgnored(state, key) &&
      (minCountOfTopSites === undefined || (site.get('count') || 0) >= minCountOfTopSites) &&
      (minAccessOfTopSites === undefined || (site.get('lastAccessedTime') || 0) >= minAccessOfTopSites)
    )
    .sort(sortCountDescending)
    .slice(0, aboutNewTabMaxEntries)
    .map((site, key) => {
      const bookmarkKey = bookmarkLocationCache.getCacheKey(state, site.get('location'))

      site = site.set('bookmarked', bookmarkKey.get(0, false))
      site = site.set('key', key)
      return site
    })
    .toList()

  for (let i = 0; i < sites.size; i++) {
    const count = sites.getIn([i, 'count'], 0)
    const access = sites.getIn([i, 'lastAccessedTime'], 0)
    if (minCountOfTopSites === undefined || count < minCountOfTopSites) {
      minCountOfTopSites = count
    }
    if (minAccessOfTopSites === undefined || access < minAccessOfTopSites) {
      minAccessOfTopSites = access
    }
  }

  // remove duplicate domains
  // we only keep uniques host names
  sites = removeDuplicateDomains(sites)

  if (sites.size < 18) {
    const preDefined = staticData
      // TODO: this doesn't work properly
      .filter((site) => {
        return !isPinned(state, site.get('key')) && !isIgnored(state, site.get('key'))
      })
      .map(site => {
        const bookmarkKey = bookmarkLocationCache.getCacheKey(state, site.get('location'))
        return site.set('bookmarked', bookmarkKey.get(0, false))
      })
    sites = sites.concat(preDefined)
  }

  let gridSites = aboutNewTabState.getPinnedTopSites(state).map(pinned => {
    // do not allow duplicates
    if (pinned) {
      sites = sites.filter(site => site.get('key') !== pinned.get('key'))
    }
    // topsites are populated once user visit a new site.
    // pinning a site to a given index is a user decision
    // and should be taken as priority. If there's an empty
    // space we just fill it with visited sites. Otherwise
    // fallback to the pinned item.
    if (!pinned) {
      const firstSite = sites.first()
      sites = sites.shift()
      return firstSite
    }
    return pinned
  })

  gridSites = gridSites.filter(site => site != null)

  appActions.topSiteDataAvailable(gridSites)
}

/**
 * TopSites are defined by users for the new tab page. Pinned sites are attached to their positions
 * in the grid, and the non pinned indexes are populated with newly accessed sites
 */
const debouncedGetTopSiteData = debounce(() => getTopSiteData(), 5 * 1000)

const clearTopSiteCacheData = () => {
  minCountOfTopSites = undefined
  minAccessOfTopSites = undefined
}

module.exports = {
  calculateTopSites,
  clearTopSiteCacheData,
  aboutNewTabMaxEntries
}
