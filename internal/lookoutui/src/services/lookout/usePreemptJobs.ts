import { useMutation } from "@tanstack/react-query"

import { getErrorMessage } from "../../common/utils"
import { getConfig } from "../../config"
import { Job, JobId } from "../../models/lookoutModels"

import { useApiClients } from "../apiClients"

export type UpdateJobsResponse = {
  successfulJobIds: JobId[]
  failedJobIds: {
    jobId: JobId
    errorReason: string
  }[]
}

export interface PreemptJobsVariables {
  jobs: Job[]
  reason: string
}

function createJobBatches(jobs: Job[], batchSize: number): Map<string, Map<string, JobId[][]>> {
  const result = new Map<string, Map<string, JobId[][]>>()
  for (const job of jobs) {
    if (!result.has(job.queue)) {
      result.set(job.queue, new Map<string, JobId[][]>())
    }
    if (!result.get(job.queue)?.has(job.jobSet)) {
      result.get(job.queue)?.set(job.jobSet, [])
    }

    const batches = result.get(job.queue)?.get(job.jobSet) ?? []
    if (batches.length === 0 || batches[batches.length - 1].length === batchSize) {
      batches.push([job.jobId])
      continue
    }

    const lastBatch = batches[batches.length - 1]
    lastBatch.push(job.jobId)
  }
  return result
}

export const usePreemptJobs = () => {
  const config = getConfig()
  const { submitApi } = useApiClients()

  return useMutation<UpdateJobsResponse, string, PreemptJobsVariables>({
    mutationFn: async ({ jobs, reason }: PreemptJobsVariables) => {
      if (config.fakeDataEnabled) {
        await new Promise((r) => setTimeout(r, 1_000))
        return {
          successfulJobIds: jobs.map((job) => job.jobId),
          failedJobIds: [],
        }
      }

      try {
        const response: UpdateJobsResponse = { successfulJobIds: [], failedJobIds: [] }

        const maxJobsPerRequest = 10000
        const chunks = createJobBatches(jobs, maxJobsPerRequest)

        const apiResponsePromises = []
        for (const [queue, jobSetMap] of chunks) {
          for (const [jobSet, batches] of jobSetMap) {
            for (const batch of batches) {
              apiResponsePromises.push({
                promise: submitApi.preemptJobs({
                  body: {
                    jobIds: batch,
                    queue: queue,
                    jobSetId: jobSet,
                    reason: reason,
                  },
                }),
                jobIds: batch,
              })
            }
          }
        }

        for (const apiResponsePromise of apiResponsePromises) {
          try {
            await apiResponsePromise.promise
            // If successful, all jobs in the batch were preempted
            response.successfulJobIds.push(...apiResponsePromise.jobIds)
          } catch (e) {
            const text = await getErrorMessage(e)
            const failedIds = apiResponsePromise.jobIds.map((jobId) => ({
              jobId: jobId,
              errorReason: text,
            }))
            response.failedJobIds.push(...failedIds)
          }
        }

        return response
      } catch (e) {
        throw await getErrorMessage(e)
      }
    },
  })
}
