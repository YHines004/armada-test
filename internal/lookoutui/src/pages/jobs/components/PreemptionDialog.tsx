import { useCallback, useEffect, useMemo, useState } from "react"

import { Refresh, Dangerous } from "@mui/icons-material"
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Alert,
  TextField,
} from "@mui/material"
import { ErrorBoundary } from "react-error-boundary"

import { waitMs } from "../../../common/utils"
import { AlertErrorFallback } from "../../../components/AlertErrorFallback"
import { useFormatNumberWithUserSettings } from "../../../components/hooks/formatNumberWithUserSettings"
import { useFormatIsoTimestampWithUserSettings } from "../../../components/hooks/formatTimeWithUserSettings"
import { useCustomSnackbar } from "../../../components/hooks/useCustomSnackbar"
import { isTerminatedJobState, Job, JobFiltersWithExcludes, JobId } from "../../../models/lookoutModels"
import { useGetAllJobsMatchingFilters } from "../../../services/lookout/useGetAllJobsMatchingFilters"
import { usePreemptJobs } from "../../../services/lookout/usePreemptJobs"

import dialogStyles from "./DialogStyles.module.css"
import { JobStatusTable } from "./JobStatusTable"

interface PreemptionDialogProps {
  onClose: () => void
  selectedItemFilters: JobFiltersWithExcludes[]
}

export const PreemptionDialog = ({ onClose, selectedItemFilters }: PreemptionDialogProps) => {
  // State
  const [jobIdsToPreemptResponses, setJobIdsToPreemptResponses] = useState<Record<JobId, string>>({})
  const [reason, setReason] = useState<string>("")
  const [isPreempting, setIsPreempting] = useState(false)
  const [hasAttemptedPreempt, setHasAttemptedPreempt] = useState(false)
  const [refetchAfterPreempt, setRefetchAfterPreempt] = useState(false)
  const openSnackbar = useCustomSnackbar()

  const formatIsoTimestamp = useFormatIsoTimestampWithUserSettings()
  const preemptJobsMutation = usePreemptJobs()

  // Fetch all jobs matching the filters using the new hook
  const {
    data: selectedJobs,
    isLoading: isLoadingJobs,
    error,
    refetch,
  } = useGetAllJobsMatchingFilters({
    filtersGroups: selectedItemFilters,
    activeJobSets: false,
    enabled: true,
  })

  const preemptableJobs = useMemo(
    () => selectedJobs.filter((job) => !isTerminatedJobState(job.state)),
    [selectedJobs],
  )

  // Actions
  const preemptJobs = useCallback(async () => {
    setIsPreempting(true)

    try {
      const response = await preemptJobsMutation.mutateAsync({
        jobs: preemptableJobs,
        reason,
      })

      if (response.failedJobIds.length === 0) {
        openSnackbar(
          "Successfully began preemption. Jobs may take some time to preempt, but you may navigate away.",
          "success",
        )
      } else if (response.successfulJobIds.length === 0) {
        openSnackbar("All jobs failed to preempt. See table for error responses.", "error")
      } else {
        openSnackbar("Some jobs failed to preempt. See table for error responses.", "warning")
      }

      const newResponseStatus = { ...jobIdsToPreemptResponses }
      response.successfulJobIds.map((jobId) => (newResponseStatus[jobId] = "Success"))
      response.failedJobIds.map(({ jobId, errorReason }) => (newResponseStatus[jobId] = errorReason))

      setJobIdsToPreemptResponses(newResponseStatus)
      setHasAttemptedPreempt(true)
    } finally {
      setIsPreempting(false)
    }
  }, [preemptableJobs, jobIdsToPreemptResponses, reason, preemptJobsMutation, openSnackbar])

  // Wait after preempt and refetch
  useEffect(() => {
    if (refetchAfterPreempt) {
      const doRefetch = async () => {
        await waitMs(500)
        refetch()
        setRefetchAfterPreempt(false)
      }
      doRefetch()
    }
  }, [refetchAfterPreempt, refetch])

  // Event handlers
  const handleReasonChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setReason(event.target.value)
    setHasAttemptedPreempt(false)
  }, [])

  const handlePreemptJobs = useCallback(async () => {
    await preemptJobs()
    // Trigger a refetch after a small delay
    setRefetchAfterPreempt(true)
  }, [preemptJobs])

  const handleRefetch = useCallback(() => {
    setJobIdsToPreemptResponses({})
    setHasAttemptedPreempt(false)
    refetch()
  }, [refetch])

  const jobsToRender = useMemo(() => preemptableJobs.slice(0, 1000), [preemptableJobs])
  const formatSubmittedTime = useCallback((job: Job) => formatIsoTimestamp(job.submitted, "full"), [formatIsoTimestamp])

  const formatNumber = useFormatNumberWithUserSettings()

  const preemptableJobsCount = preemptableJobs.length
  const selectedJobsCount = selectedJobs.length

  return (
    <Dialog open={true} onClose={onClose} fullWidth maxWidth="xl">
      <DialogTitle>
        {isLoadingJobs
          ? "Preempt jobs"
          : `Preempt ${formatNumber(preemptableJobsCount)} ${preemptableJobsCount === 1 ? "job" : "jobs"}`}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column" }}>
        <ErrorBoundary FallbackComponent={AlertErrorFallback}>
          {isLoadingJobs && (
            <div className={dialogStyles.loadingInfo}>
              Fetching info on selected jobs...
              <CircularProgress variant="indeterminate" />
            </div>
          )}

          {error && (
            <Alert severity="error" sx={{ marginBottom: "0.5em" }}>
              Failed to fetch jobs: {error}
            </Alert>
          )}

          {!isLoadingJobs && !error && (
            <>
              {preemptableJobs.length > 0 && preemptableJobs.length < selectedJobs.length && (
                <Alert severity="info" sx={{ marginBottom: "0.5em" }}>
                  {formatNumber(selectedJobsCount)} {selectedJobsCount === 1 ? "job is" : "jobs are"} selected, but only{" "}
                  {formatNumber(preemptableJobsCount)} {preemptableJobsCount === 1 ? "job is" : "jobs are"} in a
                  non-terminated state.
                </Alert>
              )}

              {preemptableJobs.length === 0 && (
                <Alert severity="success">
                  All selected jobs are in a terminated state already, therefore there is nothing to preempt.
                </Alert>
              )}

              {preemptableJobs.length > 0 && (
                <JobStatusTable
                  jobsToRender={jobsToRender}
                  jobStatus={jobIdsToPreemptResponses}
                  totalJobCount={preemptableJobs.length}
                  additionalColumnsToDisplay={[
                    { displayName: "Submitted Time", formatter: formatSubmittedTime },
                  ]}
                  showStatus={Object.keys(jobIdsToPreemptResponses).length > 0}
                />
              )}

              <TextField
                value={reason}
                autoFocus={true}
                label={"Reason for preemption (optional)"}
                margin={"normal"}
                type={"text"}
                onChange={handleReasonChange}
                sx={{ maxWidth: "500px" }}
              />
            </>
          )}
        </ErrorBoundary>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          onClick={handleRefetch}
          disabled={isLoadingJobs || isPreempting}
          variant="outlined"
          endIcon={<Refresh />}
        >
          Refetch jobs
        </Button>
        <Button
          onClick={handlePreemptJobs}
          loading={isPreempting}
          disabled={isLoadingJobs || hasAttemptedPreempt || preemptableJobs.length === 0}
          variant="contained"
          endIcon={<Dangerous />}
        >
          Preempt {formatNumber(preemptableJobsCount)} {preemptableJobsCount === 1 ? "job" : "jobs"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
