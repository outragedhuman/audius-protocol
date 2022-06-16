// @ts-nocheck
/* tslint:disable */
/* eslint-disable */
/**
 * API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
/**
 * 
 * @export
 * @interface DownloadMetadata
 */
export interface DownloadMetadata {
    /**
     * 
     * @type {string}
     * @memberof DownloadMetadata
     */
    cid?: string;
    /**
     * 
     * @type {boolean}
     * @memberof DownloadMetadata
     */
    is_downloadable: boolean;
    /**
     * 
     * @type {boolean}
     * @memberof DownloadMetadata
     */
    requires_follow: boolean;
}

export function DownloadMetadataFromJSON(json: any): DownloadMetadata {
    return DownloadMetadataFromJSONTyped(json, false);
}

export function DownloadMetadataFromJSONTyped(json: any, ignoreDiscriminator: boolean): DownloadMetadata {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'cid': !exists(json, 'cid') ? undefined : json['cid'],
        'is_downloadable': json['is_downloadable'],
        'requires_follow': json['requires_follow'],
    };
}

export function DownloadMetadataToJSON(value?: DownloadMetadata | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'cid': value.cid,
        'is_downloadable': value.is_downloadable,
        'requires_follow': value.requires_follow,
    };
}

