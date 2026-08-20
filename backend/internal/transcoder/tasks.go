package transcoder

import (
	"encoding/json"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

const (
	TypeTranscodeAsset = "asset:transcode"
)

type TranscodePayload struct {
	AssetID uuid.UUID `json:"asset_id"`
}

func NewTranscodeTask(assetID uuid.UUID) (*asynq.Task, error) {
	payload, err := json.Marshal(TranscodePayload{AssetID: assetID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TypeTranscodeAsset, payload), nil
}
