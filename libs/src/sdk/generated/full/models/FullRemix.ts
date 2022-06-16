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
import {
    UserFull,
    UserFullFromJSON,
    UserFullFromJSONTyped,
    UserFullToJSON,
} from './UserFull';

/**
 * 
 * @export
 * @interface FullRemix
 */
export interface FullRemix {
    /**
     * 
     * @type {string}
     * @memberof FullRemix
     */
    parent_track_id: string;
    /**
     * 
     * @type {UserFull}
     * @memberof FullRemix
     */
    user: UserFull;
    /**
     * 
     * @type {boolean}
     * @memberof FullRemix
     */
    has_remix_author_reposted: boolean;
    /**
     * 
     * @type {boolean}
     * @memberof FullRemix
     */
    has_remix_author_saved: boolean;
}

export function FullRemixFromJSON(json: any): FullRemix {
    return FullRemixFromJSONTyped(json, false);
}

export function FullRemixFromJSONTyped(json: any, ignoreDiscriminator: boolean): FullRemix {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'parent_track_id': json['parent_track_id'],
        'user': UserFullFromJSON(json['user']),
        'has_remix_author_reposted': json['has_remix_author_reposted'],
        'has_remix_author_saved': json['has_remix_author_saved'],
    };
}

export function FullRemixToJSON(value?: FullRemix | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'parent_track_id': value.parent_track_id,
        'user': UserFullToJSON(value.user),
        'has_remix_author_reposted': value.has_remix_author_reposted,
        'has_remix_author_saved': value.has_remix_author_saved,
    };
}

