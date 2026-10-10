package catalog

import (
	"context"
	"database/sql"
	"errors"
	"math/rand"
	"time"

	"github.com/lib/pq"
)

var errTransactionBusy = errors.New("transaction_busy")

const catalogTransactionAttempts = 16

// Only SQLSTATEs which confirm an aborted transaction permit a replay. A lost
// connection or an uncertain COMMIT never does: clients must recover a receipt.
func retryableCatalogTransaction(err error) bool {
	var pg *pq.Error
	return errors.As(err, &pg) && (pg.Code == "40001" || pg.Code == "40P01" || pg.Code == "55P03")
}

// All fact and definition writers participate in SSI, including single-object
// and lifecycle endpoints. The callback must recreate attempt-local state and
// perform effects only through tx; it may run again after a confirmed rollback.
func (s *Store) writeCatalog(ctx context.Context, fn func(*sql.Tx) error) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	for attempt := 0; attempt < catalogTransactionAttempts; attempt++ {
		err := func() error {
			tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
			if err != nil {
				return err
			}
			defer tx.Rollback()
			if _, err = tx.ExecContext(ctx, "SET LOCAL lock_timeout = '3s'"); err != nil {
				return err
			}
			if err = fn(tx); err != nil {
				return err
			}
			return tx.Commit()
		}()
		if !retryableCatalogTransaction(err) {
			return err
		}
		if attempt == catalogTransactionAttempts-1 {
			return errTransactionBusy
		}
		// Bounded jitter prevents contending commits from restarting together.
		window := 5 * time.Millisecond * time.Duration(1<<min(attempt, 4))
		timer := time.NewTimer(window + time.Duration(rand.Int63n(int64(window))))
		select {
		case <-ctx.Done():
			timer.Stop()
			return errTransactionBusy // the preceding attempt is known rolled back
		case <-timer.C:
		}
	}
	return errTransactionBusy
}
