package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	_ "github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/migrator"
	"github.com/metafusion/metafusion-app/migrations"
)

func main() {
	cfg := config.Load()

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "MetaFusion 独立版本化数据库迁移管理工具 (Database Schema Migrator)\n\n")
		fmt.Fprintf(os.Stderr, "用法:\n")
		fmt.Fprintf(os.Stderr, "  mf-migrate [command] [args]\n\n")
		fmt.Fprintf(os.Stderr, "命令:\n")
		fmt.Fprintf(os.Stderr, "  up              执行所有待处理的数据库迁移 (默认)\n")
		fmt.Fprintf(os.Stderr, "  down            回滚上一版本的数据库迁移\n")
		fmt.Fprintf(os.Stderr, "  status          查看数据库当前版本与全部迁移状态\n")
		fmt.Fprintf(os.Stderr, "  force <version> 强制解除指定版本的脏迁移 (dirty) 标记\n\n")
	}
	flag.Parse()

	args := flag.Args()
	cmd := "up"
	if len(args) > 0 {
		cmd = args[0]
	}

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable connect_timeout=10",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("无法连接数据库: %v", err)
	}
	defer db.Close()

	// 重试等待数据库就绪 (针对生产启动容器等待场景)
	var pingErr error
	for i := 0; i < 15; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		pingErr = db.PingContext(ctx)
		cancel()
		if pingErr == nil {
			break
		}
		log.Printf("等待数据库连接就绪... (尝试 %d/15): %v", i+1, pingErr)
		time.Sleep(2 * time.Second)
	}
	if pingErr != nil {
		log.Fatalf("数据库连接超时失败: %v", pingErr)
	}

	m := migrator.New(db, migrations.FS)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	switch cmd {
	case "up":
		log.Println("开始执行数据库版本迁移 (Migrate Up)...")
		if err := m.Up(ctx); err != nil {
			log.Fatalf("迁移执行失败: %v", err)
		}
		log.Println("数据库迁移全部执行成功！")

	case "down":
		log.Println("开始回滚最新版本迁移 (Migrate Down)...")
		if err := m.Down(ctx); err != nil {
			log.Fatalf("迁移回滚失败: %v", err)
		}
		log.Println("数据库迁移回滚成功！")

	case "status", "version":
		if err := m.Status(ctx); err != nil {
			log.Fatalf("查询迁移状态失败: %v", err)
		}

	case "force":
		if len(args) < 2 {
			log.Fatal("缺少版本号参数。用法: mf-migrate force <version>")
		}
		ver, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil {
			log.Fatalf("无效的版本号: %s", args[1])
		}
		if err := m.Force(ctx, ver); err != nil {
			log.Fatalf("强制解除脏状态失败: %v", err)
		}
		log.Printf("已成功解除版本 %d 的脏状态标记。", ver)

	default:
		flag.Usage()
		os.Exit(1)
	}
}
