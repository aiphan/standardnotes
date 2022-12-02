import { addToast, dismissToast, ToastType } from '@standardnotes/toast'
import { ApplicationEvent, InternalEventBus, StorageKey } from '@standardnotes/services'
import { isDev } from '@/Utils'
import { FileItem, PrefKey, sleep, SNTag } from '@standardnotes/snjs'
import { FilesController } from '../FilesController'
import { preparePhotoOperation, takePhoto, stopCameraStream } from './CameraUtils'
import { action, makeObservable, observable } from 'mobx'
import { AbstractViewController } from '@/Controllers/Abstract/AbstractViewController'
import { WebApplication } from '@/Application/Application'
import { dateToStringStyle1 } from '@/Utils/DateUtils'

const EVERY_HALF_HOUR = 1000 * 60 * 30
const EVERY_TEN_SECONDS = 1000 * 10
const DEBUG_MODE = isDev && false

const DELAY_AFTER_STARTING_CAMERA_TO_ALLOW_MOBILE_AUTOFOCUS = 2000

export class MomentsService extends AbstractViewController {
  isEnabled = false
  private intervalReference: ReturnType<typeof setInterval> | undefined

  constructor(application: WebApplication, private filesController: FilesController, eventBus: InternalEventBus) {
    super(application, eventBus)

    this.disposers.push(
      application.addEventObserver(async () => {
        this.isEnabled = (this.application.getValue(StorageKey.MomentsEnabled) as boolean) ?? false
        if (this.isEnabled) {
          void this.beginTakingPhotos()
        }
      }, ApplicationEvent.Launched),
    )

    makeObservable(this, {
      isEnabled: observable,

      enableMoments: action,
      disableMoments: action,
    })
  }

  override deinit() {
    super.deinit()
    ;(this.application as unknown) = undefined
    ;(this.filesController as unknown) = undefined
  }

  public enableMoments = (): void => {
    this.application.setValue(StorageKey.MomentsEnabled, true)

    this.isEnabled = true

    void this.beginTakingPhotos()
  }

  public disableMoments = (): void => {
    this.application.setValue(StorageKey.MomentsEnabled, false)

    this.isEnabled = false

    clearInterval(this.intervalReference)
  }

  private beginTakingPhotos() {
    void this.takePhoto()

    this.intervalReference = setInterval(
      () => {
        void this.takePhoto()
      },
      DEBUG_MODE ? EVERY_TEN_SECONDS : EVERY_HALF_HOUR,
    )
  }

  private getDefaultTag(): SNTag | undefined {
    const defaultTagId = this.application.getPreference(PrefKey.MomentsDefaultTagUuid)

    if (defaultTagId) {
      return this.application.items.findItem(defaultTagId)
    }
  }

  public async takePhoto(): Promise<FileItem[] | undefined> {
    const toastId = addToast({
      type: ToastType.Loading,
      message: 'Capturing Moment...',
    })

    const { canvas, video, stream, width, height } = await preparePhotoOperation()

    const filename = `Moment ${dateToStringStyle1(new Date())}.png`

    if (this.application.isMobileDevice) {
      await sleep(DELAY_AFTER_STARTING_CAMERA_TO_ALLOW_MOBILE_AUTOFOCUS)
    }

    let file = await takePhoto(filename, canvas, video, width, height)
    if (!file) {
      await sleep(1000)
      file = await takePhoto(filename, canvas, video, width, height)
      if (!file) {
        return undefined
      }
    }

    dismissToast(toastId)

    const uploadedFile = await this.filesController.uploadNewFile(file)

    const defaultTag = this.getDefaultTag()
    if (defaultTag && uploadedFile) {
      void this.application.linkingController.linkItems(uploadedFile[0], defaultTag)
    }

    stopCameraStream(canvas, video, stream)

    return uploadedFile
  }
}