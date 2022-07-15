import { Base, BaseConstructorArgs, Services } from './base'
import type { Nullable } from '../utils'

export enum Action {
  CREATE = 'Create',
  UPDATE = 'Update',
  DELETE = 'Delete'
}

export enum EntityType {
  PLAYLIST = 'Playlist'
}

export interface PlaylistOperationResponse {
  /**
   * Blockhash of playlist transaction
   */
  blockHash: Nullable<string>
  /**
   * Block number of playlist transaction
   */
  blockNumber: Nullable<number>
  /**
   * ID of playlist being modified
   */
  playlistId: Nullable<number>
  /**
   * String error message returned
   */
  error: Nullable<string>
}

// Minimum playlist ID, intentionally higher than legacy playlist ID range
const MIN_PLAYLIST_ID = 400000
// Maximum playlist ID, reflects postgres max integer value
const MAX_PLAYLIST_ID = 2147483647

/*
  API surface for updated data contract interactions.
  Provides simplified entity management in a generic fashion
  Handles metadata + file upload etc. for entities such as Playlist/Track/User
*/
export class EntityManager extends Base {
  constructor(...args: BaseConstructorArgs) {
    super(...args)
    this.getValidPlaylistId = this.getValidPlaylistId.bind(this)
    this.createPlaylist = this.createPlaylist.bind(this)
    this.deletePlaylist = this.deletePlaylist.bind(this)
  }

  /**
   * Generate random integer between two known values
   */
  getRandomInt(min: number, max: number): number {
    min = Math.ceil(min)
    max = Math.floor(max)
    return Math.floor(Math.random() * (max - min) + min)
  }

  /**
   * Calculate an unoccupied playlist ID
   * Maximum value is postgres integer max (2147483647)
   * Minimum value is artificially set to 400000
   */
  async getValidPlaylistId(): Promise<number> {
    let playlistId: number = this.getRandomInt(MIN_PLAYLIST_ID, MAX_PLAYLIST_ID)
    let validIdFound: boolean = false
    while (!validIdFound) {
      const resp: any = await this.discoveryProvider.getPlaylists(1, 0, [
        playlistId
      ])
      if (resp.length !== 0) {
        playlistId = this.getRandomInt(MIN_PLAYLIST_ID, MAX_PLAYLIST_ID)
      } else {
        validIdFound = true
      }
    }
    return playlistId
  }

  /**
   * Playlist default response values
   */
  getDefaultPlaylistReponseValues(): PlaylistOperationResponse {
    return {
      blockHash: null,
      blockNumber: null,
      playlistId: null,
      error: null
    }
  }

  /**
   * Create a playlist using updated data contracts flow
   */
  async createPlaylist({
    playlistName,
    trackIds,
    description,
    isAlbum,
    isPrivate,
    coverArt,
    logger = console
  }: {
    playlistName: string
    trackIds: number[]
    description: string
    isAlbum: boolean
    isPrivate: boolean
    coverArt: string
    logger: Console
  }): Promise<PlaylistOperationResponse> {
    const responseValues: PlaylistOperationResponse =
      this.getDefaultPlaylistReponseValues()
    try {
      const currentUserId: string | null =
        this.userStateManager.getCurrentUserId()
      if (!currentUserId) {
        return {
          blockHash: null,
          blockNumber: null,
          playlistId: null,
          error: 'Missing current user ID'
        }
      }
      const userId: number = parseInt(currentUserId)
      const createAction = Action.CREATE
      const entityType = EntityType.PLAYLIST
      const entityId = await this.getValidPlaylistId()
      this.REQUIRES(Services.CREATOR_NODE)
      const updatedPlaylistImage = await this.creatorNode.uploadImage(
        coverArt,
        true // square
      )
      const dirCID = updatedPlaylistImage.dirCID
      const metadata = {
        createAction,
        entity_type: entityType,
        playlist_id: entityId,
        playlist_contents: trackIds,
        playlist_name: playlistName,
        playlist_image_sizes_multihash: dirCID,
        description,
        is_album: isAlbum,
        is_private: isPrivate
      }
      const { metadataMultihash } =
        await this.creatorNode.uploadPlaylistMetadata(metadata)
      const manageEntityResponse = await this.manageEntity({
        userId: userId,
        entityType,
        entityId,
        action: createAction,
        metadataMultihash
      })
      const txReceipt = manageEntityResponse.txReceipt
      responseValues.blockHash = txReceipt.blockHash
      responseValues.blockNumber = txReceipt.blockNumber
      responseValues.playlistId = entityId
      return responseValues
    } catch (e) {
      const error = (e as Error).message
      responseValues.error = error
      return responseValues
    }
  }

  /**
   * Delete a playlist using updated data contracts flow
   */
  async deletePlaylist({
    playlistId,
    userId
  }: {
    playlistId: number
    userId: number
    logger: any
  }): Promise<PlaylistOperationResponse> {
    const responseValues: PlaylistOperationResponse =
      this.getDefaultPlaylistReponseValues()
    try {
      const resp = await this.manageEntity({
        userId,
        entityType: EntityType.PLAYLIST,
        entityId: playlistId,
        action: Action.DELETE,
        metadataMultihash: ''
      })
      const txReceipt = resp.txReceipt
      responseValues.blockHash = txReceipt.blockHash
      responseValues.blockNumber = txReceipt.blockNumber
      responseValues.playlistId = playlistId
      return responseValues
    } catch (e) {
      const error = (e as Error).message
      responseValues.error = error
      return responseValues
    }
  }

  /**
   * Update a playlist using updated data contracts flow
   **/
  async updatePlaylist({
    playlistId,
    playlistName,
    trackIds,
    description,
    isAlbum,
    isPrivate,
    coverArt,
    logger = console
  }: {
    playlistId: number
    playlistName: string
    trackIds: number[]
    description: string
    isAlbum: boolean
    isPrivate: boolean
    coverArt: string
    logger: Console
  }): Promise<PlaylistOperationResponse> {
    let error = null
    try {
      const currentUserId: string | null =
        this.userStateManager.getCurrentUserId()
      if (!currentUserId) {
        return {
          blockHash: null,
          blockNumber: null,
          playlistId: null,
          error: 'Missing current user ID'
        }
      }
      const userId: number = parseInt(currentUserId)
      const updateAction = Action.UPDATE
      const entityType = EntityType.PLAYLIST
      this.REQUIRES(Services.CREATOR_NODE)
      let dirCID
      if (coverArt) {
        const updatedPlaylistImage = await this.creatorNode.uploadImage(
          coverArt,
          true // square
        )
        dirCID = updatedPlaylistImage.dirCID
      }

      const playlist: any = (
        await this.discoveryProvider.getPlaylists(1, 0, [playlistId])
      )[0]

      const metadata = {
        action: updateAction, // why include action here?
        entityType,
        playlist_id: playlistId,
        playlist_contents: trackIds || playlist.playlist_contents,
        playlist_name: playlistName || playlist.playlist_name,
        playlist_image_sizes_multihash:
          dirCID || playlist.playlist_image_sizes_multihash,
        description: description || playlist.description,
        is_album: isAlbum || playlist.is_album,
        is_private: isPrivate || playlist.is_private
      }
      const { metadataMultihash } =
        await this.creatorNode.uploadPlaylistMetadata(metadata)

      const resp = await this.manageEntity({
        userId,
        entityType,
        entityId: playlistId,
        action: updateAction,
        metadataMultihash
      })
      const txReceipt = resp.txReceipt
      return {
        blockHash: txReceipt.blockHash,
        blockNumber: txReceipt.blockNumber,
        playlistId,
        error
      }
    } catch (e) {
      error = (e as Error).message
      return {
        blockHash: null,
        blockNumber: null,
        playlistId: null,
        error
      }
    }
  }

  /**
   * Manage an entity with the updated data contract flow
   * Leveraged to manipulate User/Track/Playlist/+ other entities
   */
  async manageEntity({
    userId,
    entityType,
    entityId,
    action,
    metadataMultihash
  }: {
    userId: number
    entityType: EntityType
    entityId: number
    action: Action
    metadataMultihash: string
  }): Promise<
    { txReceipt: any; error: null } | { txReceipt: null; error: string }
  > {
    let error = null
    let resp: any
    try {
      resp = await this.contracts.EntityManagerClient?.manageEntity(
        userId,
        entityType,
        entityId,
        action,
        metadataMultihash
      )
      return { txReceipt: resp.txReceipt, error }
    } catch (e) {
      error = (e as Error).message
      return { txReceipt: null, error }
    }
  }
}
