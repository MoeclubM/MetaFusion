package main

import (
	"context"
	"log"

	"github.com/hibiken/asynq"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/database"
	"github.com/metafusion/metafusion-app/internal/transcoder"
)

func main() {
	cfg := config.Load()

	// 1. 初始化数据库连接
	db, err := database.InitDB(cfg)
	if err != nil {
		log.Fatalf("Worker failed to connect to database: %v", err)
	}

	// 2. 初始化转码处理器
	processor, err := transcoder.NewProcessor(db, cfg)
	if err != nil {
		log.Fatalf("Failed to initialize transcoder processor: %v", err)
	}

	// 3. 启动 Asynq Worker 服务器
	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: cfg.RedisAddr},
		asynq.Config{
			Concurrency: cfg.MaxConcurrentVideo,
			Queues: map[string]int{
				"transcode": 10,
				"default":   5,
			},
		},
	)

	mux := asynq.NewServeMux()
	mux.HandleFunc(transcoder.TypeTranscodeAsset, func(ctx context.Context, t *asynq.Task) error {
		return processor.ProcessTask(ctx, t)
	})

	log.Printf("MetaFusion Transcoder Worker started (Concurrency: %d, Queues: transcode)...", cfg.MaxConcurrentVideo)
	if err := srv.Run(mux); err != nil {
		log.Fatalf("Could not run Asynq server: %v", err)
	}
}
